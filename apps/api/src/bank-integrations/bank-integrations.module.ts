import {
  Module, Injectable, NotFoundException, BadRequestException, Logger,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsBoolean, IsEnum, MaxLength, IsDateString,
} from 'class-validator';
import {
  Profile, BankIntegrationProvider, BankConnectionStatus, StatementStatus, StatementLineStatus, StatementLineType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { encrypt, decrypt } from '../fiscal/crypto.helper';
import { serializeBigInt } from '../financial/money.helper';
import { createBankAdapter, AccountSnapshot, TransactionSnapshot } from './providers/pluggy.adapter';

// =================== DTOs ===================

class UpsertIntegrationDto {
  @IsString() company_id: string;
  @IsOptional() @IsEnum(BankIntegrationProvider) type?: BankIntegrationProvider;
  @IsString() client_id: string;
  @IsString() client_secret: string;
  @IsOptional() @IsBoolean() sandbox_mode?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ConnectTokenDto {
  @IsString() company_id: string;
  /** Para reconectar item existente */
  @IsOptional() @IsString() item_id?: string;
}

class RegisterConnectionDto {
  @IsString() company_id: string;
  /** itemId retornado pelo widget após o titular autorizar */
  @IsString() item_id: string;
}

class SyncDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// =================== SERVICE ===================

@Injectable()
export class BankIntegrationsService {
  private readonly logger = new Logger(BankIntegrationsService.name);
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private assertCompanyAccess(companyId: string, current: any) {
    if (current.profile === Profile.ADMIN) return;
    if (current.profile === Profile.MANAGER && current.company_id === companyId) return;
    throw new BadRequestException('Sem acesso a esta empresa.');
  }

  private maskKey(s: string): string {
    if (!s) return '';
    if (s.length <= 8) return '••••';
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  // ---------- Integration config ----------

  async getIntegration(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);
    const integ = await this.prisma.bankIntegration.findUnique({ where: { company_id: companyId } });
    if (!integ) return null;
    return {
      ...integ,
      client_id: this.maskKey(integ.client_id),
      client_secret: '••••••••',
    };
  }

  async upsertIntegration(dto: UpsertIntegrationDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);

    const data: any = {
      type: dto.type ?? BankIntegrationProvider.PLUGGY,
      client_id: dto.client_id, // não criptografado — é "público" no Pluggy
      client_secret: encrypt(dto.client_secret),
      sandbox_mode: dto.sandbox_mode ?? true,
    };
    if (dto.notes !== undefined) data.notes = dto.notes;

    const existing = await this.prisma.bankIntegration.findUnique({ where: { company_id: dto.company_id } });
    const saved = existing
      ? await this.prisma.bankIntegration.update({ where: { id: existing.id }, data })
      : await this.prisma.bankIntegration.create({ data: { ...data, company_id: dto.company_id } });
    await this.audit.log(existing ? 'UPDATE' : 'CREATE', 'BANK_INTEGRATION', saved.id, current.id);
    return { ...saved, client_id: this.maskKey(saved.client_id), client_secret: '••••••••' };
  }

  // ---------- Connect token (frontend widget) ----------

  async createConnectToken(dto: ConnectTokenDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);
    const integ = await this.prisma.bankIntegration.findUnique({ where: { company_id: dto.company_id } });
    if (!integ) throw new BadRequestException('Configure a integração bancária primeiro.');

    const adapter = createBankAdapter(integ.type, integ.client_id, decrypt(integ.client_secret), integ.sandbox_mode);
    try {
      const result = await adapter.createConnectToken({
        client_user_id: dto.company_id,
        item_id: dto.item_id,
      });
      return result;
    } catch (err: any) {
      await this.prisma.bankIntegration.update({ where: { id: integ.id }, data: { last_error: err.message } });
      throw new BadRequestException(err.message);
    }
  }

  // ---------- Register connection (after widget) ----------

  async registerConnection(dto: RegisterConnectionDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);
    const integ = await this.prisma.bankIntegration.findUnique({ where: { company_id: dto.company_id } });
    if (!integ) throw new BadRequestException('Configure a integração bancária primeiro.');

    const adapter = createBankAdapter(integ.type, integ.client_id, decrypt(integ.client_secret), integ.sandbox_mode);
    const item = await adapter.getItem(dto.item_id);

    const data: any = {
      provider_item_id: item.id,
      provider_connector_id: String(item.connector_id ?? ''),
      institution_name: item.connector_name,
      institution_logo: item.connector_logo,
      status: this.mapStatus(item.status),
      status_detail: item.status_detail,
      next_auto_sync_at: item.next_auto_sync_at,
      last_sync_at: item.last_updated_at,
      raw_meta: item.raw,
    };

    const existing = await this.prisma.bankConnection.findFirst({
      where: { integration_id: integ.id, provider_item_id: dto.item_id },
    });
    const conn = existing
      ? await this.prisma.bankConnection.update({ where: { id: existing.id }, data })
      : await this.prisma.bankConnection.create({
          data: { ...data, company_id: dto.company_id, integration_id: integ.id },
        });

    await this.audit.log('REGISTER_CONNECTION', 'BANK_CONNECTION', conn.id, current.id, { provider_item_id: dto.item_id });

    // Já dispara sync inicial (best-effort)
    this.syncConnection(conn.id, {}, current).catch(e => this.logger.warn('Sync inicial falhou: ' + e?.message));

    return conn;
  }

  // ---------- List connections ----------

  async listConnections(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);
    const conns = await this.prisma.bankConnection.findMany({
      where: { company_id: companyId, metadeleted: false },
      include: {
        bank_accounts: { select: { id: true, name: true, current_balance: true, provider_account_id: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return serializeBigInt(conns);
  }

  // ---------- Disconnect ----------

  async disconnect(connectionId: string, current: any) {
    const conn = await this.prisma.bankConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexão não encontrada.');
    this.assertCompanyAccess(conn.company_id, current);
    await this.prisma.bankConnection.update({
      where: { id: connectionId },
      data: { metadeleted: true, status: BankConnectionStatus.DISCONNECTED },
    });
    await this.audit.log('DISCONNECT', 'BANK_CONNECTION', connectionId, current.id);
    return { ok: true };
  }

  // ---------- Sync transactions ----------

  async syncConnection(connectionId: string, dto: SyncDto, current: any) {
    const conn = await this.prisma.bankConnection.findUnique({
      where: { id: connectionId },
      include: { integration: true },
    });
    if (!conn || conn.metadeleted) throw new NotFoundException('Conexão não encontrada.');
    this.assertCompanyAccess(conn.company_id, current);

    const adapter = createBankAdapter(
      conn.integration.type,
      conn.integration.client_id,
      decrypt(conn.integration.client_secret),
      conn.integration.sandbox_mode,
    );

    // Atualiza estado do item
    const item = await adapter.getItem(conn.provider_item_id);
    await this.prisma.bankConnection.update({
      where: { id: connectionId },
      data: {
        status: this.mapStatus(item.status),
        status_detail: item.status_detail,
        last_sync_at: item.last_updated_at,
        next_auto_sync_at: item.next_auto_sync_at,
        last_error: null,
        raw_meta: item.raw,
      },
    });

    // Lista contas e atualiza/vincula BankAccount locais
    const accounts = await adapter.listAccounts(conn.provider_item_id);
    const counters = { accounts_synced: 0, transactions_imported: 0, statement_lines_created: 0 };
    for (const acc of accounts) {
      counters.accounts_synced += await this.upsertBankAccount(conn, acc) ? 1 : 0;
    }

    // Para cada conta vinculada, baixa transações no período e gera StatementLines
    const linkedAccounts = await this.prisma.bankAccount.findMany({
      where: { bank_connection_id: connectionId, metadeleted: false },
    });

    const from = dto.from ? new Date(dto.from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 dias
    const to = dto.to ? new Date(dto.to) : new Date();

    for (const local of linkedAccounts) {
      if (!local.provider_account_id) continue;
      const txs = await adapter.listTransactions({
        account_id: local.provider_account_id,
        from, to,
      });
      counters.transactions_imported += txs.length;
      const lines = await this.upsertStatement(local.id, conn, from, to, txs);
      counters.statement_lines_created += lines;
    }

    await this.audit.log('SYNC_BANK_CONNECTION', 'BANK_CONNECTION', connectionId, current.id, counters);
    return counters;
  }

  /**
   * Cria ou atualiza um BankAccount local a partir de uma conta do provedor.
   * Se já existe BankAccount com mesmo provider_account_id, só atualiza saldo;
   * caso contrário, cria como inativo (para o usuário associar manualmente,
   * ou linka automaticamente se for óbvio).
   */
  private async upsertBankAccount(conn: any, acc: AccountSnapshot): Promise<boolean> {
    const existing = await this.prisma.bankAccount.findFirst({
      where: { company_id: conn.company_id, provider_account_id: acc.id, metadeleted: false },
    });
    const balanceCents = acc.balance != null ? BigInt(Math.round(acc.balance * 100)) : 0n;
    if (existing) {
      await this.prisma.bankAccount.update({
        where: { id: existing.id },
        data: { current_balance: balanceCents },
      });
      return true;
    }
    // Cria conta nova vinculada (inativa por padrão — usuário ativa quando confirmar)
    await this.prisma.bankAccount.create({
      data: {
        name: acc.name ?? acc.subtype ?? 'Conta capturada',
        type: acc.subtype === 'CREDIT_CARD' ? 'PSP_GATEWAY' : (acc.subtype === 'SAVINGS_ACCOUNT' ? 'SAVINGS' : 'CHECKING'),
        bank_name: conn.institution_name,
        account_number: acc.number,
        initial_balance: 0n,
        current_balance: balanceCents,
        is_active: false,
        company_id: conn.company_id,
        bank_connection_id: conn.id,
        provider_account_id: acc.id,
      },
    });
    return true;
  }

  /**
   * Cria/atualiza um BankStatement do período sincronizado e adiciona/atualiza
   * suas BankStatementLines. Idempotente por (statement.bank_account_id, line.fit_id=provider_id).
   */
  private async upsertStatement(
    bankAccountId: string,
    conn: any,
    from: Date,
    to: Date,
    txs: TransactionSnapshot[],
  ): Promise<number> {
    if (txs.length === 0) return 0;

    // Busca ou cria um statement "open finance" do período
    const filename = `pluggy-${conn.id}-${from.toISOString().slice(0, 10)}.json`;
    let statement = await this.prisma.bankStatement.findFirst({
      where: { bank_account_id: bankAccountId, filename, metadeleted: false },
    });
    if (!statement) {
      statement = await this.prisma.bankStatement.create({
        data: {
          filename,
          file_format: 'OPEN_FINANCE',
          start_date: from,
          end_date: to,
          status: StatementStatus.PROCESSING,
          total_lines: txs.length,
          matched_lines: 0,
          bank_account_id: bankAccountId,
          company_id: conn.company_id,
        },
      });
    } else {
      await this.prisma.bankStatement.update({
        where: { id: statement.id },
        data: { end_date: to, total_lines: { increment: txs.length } },
      });
    }

    let created = 0;
    for (const t of txs) {
      const existing = await this.prisma.bankStatementLine.findFirst({
        where: { statement_id: statement.id, fit_id: t.id },
      });
      const lineData: any = {
        date: t.date,
        description: t.description.slice(0, 300),
        amount: BigInt(Math.round(Math.abs(t.amount) * 100)),
        type: t.amount >= 0 ? StatementLineType.CREDIT : StatementLineType.DEBIT,
        fit_id: t.id,
        reference: t.category,
        status: StatementLineStatus.UNMATCHED,
        statement_id: statement.id,
      };
      if (existing) {
        await this.prisma.bankStatementLine.update({ where: { id: existing.id }, data: lineData });
      } else {
        await this.prisma.bankStatementLine.create({ data: lineData });
        created++;
      }
    }

    return created;
  }

  private mapStatus(raw: string): BankConnectionStatus {
    const s = (raw ?? '').toUpperCase();
    if (s === 'UPDATED' || s === 'UPDATING') return s === 'UPDATING' ? BankConnectionStatus.UPDATING : BankConnectionStatus.ACTIVE;
    if (s.includes('WAITING')) return BankConnectionStatus.WAITING_USER_INPUT;
    if (s.includes('LOGIN_ERROR') || s === 'LOGIN_ERROR') return BankConnectionStatus.LOGIN_ERROR;
    if (s === 'OUTDATED') return BankConnectionStatus.OUTDATED;
    if (s.includes('ERROR')) return BankConnectionStatus.ERROR;
    return BankConnectionStatus.ACTIVE;
  }
}

// =================== CONTROLLER ===================

@ApiTags('bank-integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('bank-integrations')
export class BankIntegrationsController {
  constructor(private service: BankIntegrationsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('config/:companyId')
  getConfig(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.getIntegration(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('config')
  upsertConfig(@Body() dto: UpsertIntegrationDto, @CurrentUser() user: any) {
    return this.service.upsertIntegration(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('connect-token')
  connectToken(@Body() dto: ConnectTokenDto, @CurrentUser() user: any) {
    return this.service.createConnectToken(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('connections')
  register(@Body() dto: RegisterConnectionDto, @CurrentUser() user: any) {
    return this.service.registerConnection(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('connections/:companyId')
  list(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listConnections(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('connections/:id/sync')
  sync(@Param('id') id: string, @Body() dto: SyncDto, @CurrentUser() user: any) {
    return this.service.syncConnection(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete('connections/:id')
  disconnect(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.disconnect(id, user);
  }
}

@Module({
  controllers: [BankIntegrationsController],
  providers: [BankIntegrationsService],
  exports: [BankIntegrationsService],
})
export class BankIntegrationsModule {}
