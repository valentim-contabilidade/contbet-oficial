import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, IsNumber, IsDateString, Min } from 'class-validator';
import { Profile, StatementLineStatus, StatementStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';
import { parseStatement, ParsedStatementLine } from './statement-parser';

class ImportStatementDto {
  @IsString() bank_account_id: string;
  @IsString() filename: string;
  @IsString() content: string; // conteúdo do arquivo em texto (OFX/CSV é texto)
}

class MatchLineDto {
  @IsString() transaction_id: string;
}

class CreateTransactionFromLineDto {
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() account_id?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@Injectable()
export class BankStatementsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * Tenta encontrar uma transação existente que case com a linha do extrato.
   * Critérios:
   *  - Mesmo valor (em centavos)
   *  - Mesmo tipo (entrada/saída)
   *  - Data dentro de ±3 dias
   *  - Não conciliada ainda
   */
  private async findMatch(line: ParsedStatementLine, bankAccountId: string) {
    const targetType = line.type === 'CREDIT' ? TransactionType.INCOME : TransactionType.EXPENSE;
    const startDate = new Date(line.date);
    startDate.setDate(startDate.getDate() - 3);
    const endDate = new Date(line.date);
    endDate.setDate(endDate.getDate() + 3);

    const candidates = await this.prisma.transaction.findMany({
      where: {
        bank_account_id: bankAccountId,
        type: targetType,
        amount: line.amount,
        date: { gte: startDate, lte: endDate },
        metadeleted: false,
        statement_lines: { none: {} }, // ainda não foi conciliada
      },
      orderBy: { date: 'asc' },
      take: 1,
    });

    if (candidates.length === 0) return null;
    const tx = candidates[0];
    // Score: distância entre datas
    const dayDiff = Math.abs((line.date.getTime() - tx.date.getTime()) / (1000 * 60 * 60 * 24));
    const score = Math.max(50, 100 - Math.round(dayDiff * 10));
    return { transaction: tx, score };
  }

  async importStatement(dto: ImportStatementDto, current: any) {
    const bankAccount = await this.prisma.bankAccount.findUnique({ where: { id: dto.bank_account_id } });
    if (!bankAccount || bankAccount.metadeleted) throw new BadRequestException('Conta bancária inválida.');
    assertTenantAccess(bankAccount, current);

    const { format, parsed } = parseStatement(dto.filename, dto.content);
    if (parsed.lines.length === 0) {
      throw new BadRequestException('Nenhuma transação encontrada no arquivo.');
    }

    // Cria o extrato
    const statement = await this.prisma.bankStatement.create({
      data: {
        filename: dto.filename,
        file_format: format,
        start_date: parsed.start_date,
        end_date: parsed.end_date,
        initial_balance: parsed.initial_balance,
        final_balance: parsed.final_balance,
        company_id: bankAccount.company_id,
        bank_account_id: dto.bank_account_id,
        total_lines: parsed.lines.length,
        status: StatementStatus.PROCESSING,
      },
    });

    let matched = 0;
    for (const line of parsed.lines) {
      const match = await this.findMatch(line, dto.bank_account_id);

      // Verifica se já existe linha com mesmo fit_id (deduplicação)
      let skipReason: string | null = null;
      if (line.fit_id) {
        const existing = await this.prisma.bankStatementLine.findFirst({
          where: { fit_id: line.fit_id, statement: { bank_account_id: dto.bank_account_id, metadeleted: false } },
        });
        if (existing) skipReason = 'duplicate_fit_id';
      }

      const newLine = await this.prisma.bankStatementLine.create({
        data: {
          statement_id: statement.id,
          date: line.date,
          description: line.description,
          amount: line.amount,
          type: line.type,
          fit_id: line.fit_id,
          reference: line.reference,
          status: skipReason ? StatementLineStatus.IGNORED : (match ? StatementLineStatus.MATCHED : StatementLineStatus.UNMATCHED),
          match_score: match?.score,
          transaction_id: match?.transaction.id,
        },
      });
      if (match) matched++;
    }

    const finalStatus =
      matched === parsed.lines.length ? StatementStatus.RECONCILED :
      matched > 0 ? StatementStatus.PARTIAL :
      StatementStatus.UNRECONCILED;

    await this.prisma.bankStatement.update({
      where: { id: statement.id },
      data: { status: finalStatus, matched_lines: matched },
    });

    await this.audit.log('IMPORT', 'BANK_STATEMENT', statement.id, current.id, {
      filename: dto.filename, total: parsed.lines.length, matched,
    });

    return serializeBigInt(await this.prisma.bankStatement.findUnique({
      where: { id: statement.id },
      include: { lines: { orderBy: { date: 'asc' } } },
    }));
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.bank_account_id) where.bank_account_id = filters.bank_account_id;
    if (filters.status) where.status = filters.status;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.bankStatement.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
          bank_account: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.bankStatement.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const s = await this.prisma.bankStatement.findUnique({
      where: { id },
      include: {
        bank_account: { select: { id: true, name: true } },
        lines: {
          orderBy: { date: 'asc' },
          include: {
            transaction: {
              select: { id: true, description: true, amount: true, date: true, type: true },
            },
          },
        },
      },
    });
    if (!s || s.metadeleted) throw new NotFoundException('Extrato não encontrado.');
    assertTenantAccess(s, current);
    return serializeBigInt(s);
  }

  /** Concilia uma linha com uma transação existente */
  async matchLine(lineId: string, dto: MatchLineDto, current: any) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id: lineId },
      include: { statement: true },
    });
    if (!line) throw new NotFoundException('Linha não encontrada.');
    assertTenantAccess(line.statement, current);

    const tx = await this.prisma.transaction.findUnique({ where: { id: dto.transaction_id } });
    if (!tx || tx.metadeleted) throw new BadRequestException('Transação inválida.');
    if (tx.bank_account_id !== line.statement.bank_account_id) {
      throw new BadRequestException('Transação não pertence à mesma conta bancária do extrato.');
    }

    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: StatementLineStatus.MATCHED, transaction_id: tx.id, match_score: 100 },
    });
    await this.recalcStatementStatus(line.statement_id);
    await this.audit.log('MATCH', 'BANK_STATEMENT_LINE', lineId, current.id, { transaction_id: tx.id });
    return { ok: true };
  }

  /** Cria uma transação a partir de uma linha não conciliada e marca como CREATED */
  async createTransactionFromLine(lineId: string, dto: CreateTransactionFromLineDto, current: any) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id: lineId },
      include: { statement: { include: { bank_account: true } } },
    });
    if (!line) throw new NotFoundException('Linha não encontrada.');
    assertTenantAccess(line.statement, current);
    if (line.status === StatementLineStatus.MATCHED || line.status === StatementLineStatus.CREATED) {
      throw new BadRequestException('Linha já foi processada.');
    }

    const txType = line.type === 'CREDIT' ? TransactionType.INCOME : TransactionType.EXPENSE;
    const result = await this.prisma.$transaction(async (tx) => {
      const newTx = await tx.transaction.create({
        data: {
          description: line.description,
          amount: line.amount,
          type: txType,
          date: line.date,
          company_id: line.statement.company_id,
          bank_account_id: line.statement.bank_account_id,
          category_id: dto.category_id,
          account_id: dto.account_id,
          notes: dto.notes ?? `Conciliação extrato ${line.statement.filename}`,
          reference: line.fit_id || line.reference,
        },
      });

      // Atualiza saldo da conta
      if (txType === TransactionType.INCOME) {
        await tx.bankAccount.update({
          where: { id: line.statement.bank_account_id },
          data: { current_balance: { increment: line.amount } },
        });
      } else {
        await tx.bankAccount.update({
          where: { id: line.statement.bank_account_id },
          data: { current_balance: { decrement: line.amount } },
        });
      }

      // Marca linha como CREATED
      await tx.bankStatementLine.update({
        where: { id: lineId },
        data: { status: StatementLineStatus.CREATED, transaction_id: newTx.id, match_score: 100 },
      });

      return newTx;
    });

    await this.recalcStatementStatus(line.statement_id);
    await this.audit.log('CREATE_FROM_STATEMENT', 'TRANSACTION', result.id, current.id);
    return serializeBigInt(result);
  }

  /** Marca uma linha como ignorada */
  async ignoreLine(lineId: string, current: any) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id: lineId },
      include: { statement: true },
    });
    if (!line) throw new NotFoundException('Linha não encontrada.');
    assertTenantAccess(line.statement, current);
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: StatementLineStatus.IGNORED, transaction_id: null },
    });
    await this.recalcStatementStatus(line.statement_id);
    return { ok: true };
  }

  /** Remove uma conciliação (volta linha para UNMATCHED) */
  async unmatchLine(lineId: string, current: any) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id: lineId },
      include: { statement: true },
    });
    if (!line) throw new NotFoundException('Linha não encontrada.');
    assertTenantAccess(line.statement, current);
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: StatementLineStatus.UNMATCHED, transaction_id: null, match_score: null },
    });
    await this.recalcStatementStatus(line.statement_id);
    return { ok: true };
  }

  private async recalcStatementStatus(statementId: string) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { statement_id: statementId },
      select: { status: true },
    });
    const total = lines.length;
    const matched = lines.filter(l => l.status === 'MATCHED' || l.status === 'CREATED' || l.status === 'IGNORED').length;
    const status =
      matched === total ? StatementStatus.RECONCILED :
      matched > 0 ? StatementStatus.PARTIAL :
      StatementStatus.UNRECONCILED;
    await this.prisma.bankStatement.update({
      where: { id: statementId },
      data: { status, matched_lines: matched },
    });
  }

  async remove(id: string, current: any) {
    const s = await this.findOne(id, current);
    await this.prisma.bankStatement.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'BANK_STATEMENT', id, current.id);
    return { ok: true };
  }

  /** Sugere transações candidatas para conciliar com uma linha não casada */
  async suggestMatches(lineId: string, current: any) {
    const line = await this.prisma.bankStatementLine.findUnique({
      where: { id: lineId },
      include: { statement: true },
    });
    if (!line) throw new NotFoundException('Linha não encontrada.');
    assertTenantAccess(line.statement, current);

    const targetType = line.type === 'CREDIT' ? TransactionType.INCOME : TransactionType.EXPENSE;
    const dateFrom = new Date(line.date);
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateTo = new Date(line.date);
    dateTo.setDate(dateTo.getDate() + 7);

    const txs = await this.prisma.transaction.findMany({
      where: {
        bank_account_id: line.statement.bank_account_id,
        type: targetType,
        date: { gte: dateFrom, lte: dateTo },
        metadeleted: false,
        statement_lines: { none: {} },
      },
      orderBy: [{ date: 'desc' }],
      take: 10,
    });

    return serializeBigInt(txs);
  }
}

@ApiTags('financial/bank-statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/bank-statements')
export class BankStatementsController {
  constructor(private service: BankStatementsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('import')
  importStatement(@Body() dto: ImportStatementDto, @CurrentUser() user: any) {
    return this.service.importStatement(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('lines/:lineId/suggest')
  suggestMatches(@Param('lineId') lineId: string, @CurrentUser() user: any) {
    return this.service.suggestMatches(lineId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('lines/:lineId/match')
  matchLine(@Param('lineId') lineId: string, @Body() dto: MatchLineDto, @CurrentUser() user: any) {
    return this.service.matchLine(lineId, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('lines/:lineId/create-transaction')
  createFromLine(@Param('lineId') lineId: string, @Body() dto: CreateTransactionFromLineDto, @CurrentUser() user: any) {
    return this.service.createTransactionFromLine(lineId, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('lines/:lineId/ignore')
  ignoreLine(@Param('lineId') lineId: string, @CurrentUser() user: any) {
    return this.service.ignoreLine(lineId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('lines/:lineId/unmatch')
  unmatchLine(@Param('lineId') lineId: string, @CurrentUser() user: any) {
    return this.service.unmatchLine(lineId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

@Module({
  controllers: [BankStatementsController],
  providers: [BankStatementsService],
  exports: [BankStatementsService],
})
export class BankStatementsModule {}
