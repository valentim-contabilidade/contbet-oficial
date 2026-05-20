import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean, Matches } from 'class-validator';
import { AccountType, Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';
import { syncDefaultChartOfAccountsForCompany } from './default-accounts';

class CreateChartOfAccountDto {
  @IsString() @Matches(/^[\d.]+$/, { message: 'Código deve conter apenas números e pontos' })
  code: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(AccountType) type: AccountType;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() parent_id?: string;
  @IsOptional() @IsString() company_id?: string;
}

class UpdateChartOfAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateChartOfAccountDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);

    const exists = await this.prisma.chartOfAccount.findFirst({
      where: { company_id, code: dto.code, metadeleted: false },
    });
    if (exists) throw new BadRequestException('Código já cadastrado nesta empresa.');

    if (dto.parent_id) {
      const parent = await this.prisma.chartOfAccount.findUnique({ where: { id: dto.parent_id } });
      if (!parent || parent.metadeleted || parent.company_id !== company_id) {
        throw new BadRequestException('Conta pai inválida.');
      }
    }

    const account = await this.prisma.chartOfAccount.create({
      data: { ...dto, company_id },
    });
    await this.audit.log('CREATE', 'CHART_OF_ACCOUNT', account.id, current.id);
    return serializeBigInt(account);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.code) where.code = { contains: filters.code };
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.type) where.type = filters.type;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.chartOfAccount.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const account = await this.prisma.chartOfAccount.findUnique({ where: { id } });
    if (!account || account.metadeleted) throw new NotFoundException('Conta não encontrada.');
    assertTenantAccess(account, current);
    return serializeBigInt(account);
  }

  async update(id: string, dto: UpdateChartOfAccountDto, current: any) {
    await this.findOne(id, current);
    const updated = await this.prisma.chartOfAccount.update({ where: { id }, data: dto });
    await this.audit.log('UPDATE', 'CHART_OF_ACCOUNT', id, current.id);
    return serializeBigInt(updated);
  }

  async syncDefaults(companyId: string, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    if (current.profile !== Profile.ADMIN && current.profile !== Profile.MANAGER) {
      throw new BadRequestException('Sem permissão.');
    }
    const res = await syncDefaultChartOfAccountsForCompany(this.prisma, companyId);
    await this.audit.log('SYNC_DEFAULTS', 'CHART_OF_ACCOUNT', companyId, current.id, res);
    return res;
  }

  async remove(id: string, current: any) {
    await this.findOne(id, current);
    // Não permite deletar se tem filhas ou está em uso
    const hasChildren = await this.prisma.chartOfAccount.count({ where: { parent_id: id, metadeleted: false } });
    if (hasChildren > 0) throw new BadRequestException('Não é possível excluir: existem subcontas vinculadas.');
    await this.prisma.chartOfAccount.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'CHART_OF_ACCOUNT', id, current.id);
    return { ok: true };
  }

  /**
   * Importa plano de contas a partir de XLSX/XLS exportado de sistema
   * contábil estilo Domínio (colunas: Código interno, T, Classificação,
   * Nome com indentação por grau, Grau).
   *
   * Estratégia (modo "replace" = substitui o atual da empresa):
   *  1. Marca todas as contas atuais como metadeleted=true (preserva FKs).
   *  2. Para cada conta do arquivo:
   *     - Se já existe pelo code: atualiza nome/tipo/parent + metadeleted=false (re-aproveita id, mantém FKs antigos válidos)
   *     - Se não existe: cria.
   *  3. Resolve parent_id em segunda passada (após todas terem id).
   *
   * dryRun=true → só faz o parse + validação, retorna estatísticas sem mexer no banco.
   */
  async importFromXlsxBase64(
    companyId: string,
    fileBase64: string,
    options: { dryRun?: boolean } = {},
    current: any,
  ) {
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company || company.metadeleted) throw new NotFoundException('Empresa não encontrada.');

    const buf = Buffer.from(fileBase64, 'base64');
    // Lazy require pra evitar custo se a feature não for usada
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    let wb;
    try {
      wb = XLSX.read(buf, { type: 'buffer' });
    } catch (err: any) {
      throw new BadRequestException(`Arquivo inválido: ${err.message}`);
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new BadRequestException('Planilha vazia ou sem aba "Contas".');
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

    // Esquema: Cabeçalho em row[4]; linhas começam em row[5].
    // Colunas: Classificação no índice 7; Nome em qualquer das colunas 11..16
    // (a coluna varia conforme o grau — Domínio usa indentação visual);
    // Sintética/Analítica: índice 3 ("S" = sintética, vazio = analítica).
    type ParsedAccount = {
      code: string;
      name: string;
      isSintetica: boolean;
      grau: number;
      parent_code: string | null;
      type: AccountType;
    };
    const parsed: ParsedAccount[] = [];
    const seenCodes = new Set<string>();

    for (let i = 5; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const code = (r[7] ?? '').toString().trim();
      if (!code || !/^[\d.]+$/.test(code)) continue;
      let name: string | null = null;
      for (let c = 11; c <= 16; c++) {
        const v = r[c];
        if (v != null && String(v).trim() !== '') { name = String(v).trim(); break; }
      }
      if (!name) continue;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);

      const isS = (r[3] ?? '').toString().toUpperCase() === 'S';
      const grau = parseInt(r[21] ?? '0', 10) || code.split('.').length;

      // parent_code = code sem o último segmento, se grau > 1
      const parts = code.split('.');
      const parent_code = parts.length > 1 ? parts.slice(0, -1).join('.') : null;

      parsed.push({
        code, name, isSintetica: isS, grau, parent_code,
        type: this.inferAccountType(code),
      });
    }

    if (parsed.length === 0) {
      throw new BadRequestException('Nenhuma conta encontrada no arquivo.');
    }

    // Garante que cada parent referenciado também está na lista; se não
    // estiver, isso vira um warning (mas não bloqueia).
    const codeSet = new Set(parsed.map(p => p.code));
    const orphans = parsed.filter(p => p.parent_code && !codeSet.has(p.parent_code));

    if (options.dryRun) {
      return {
        ok: true,
        dry_run: true,
        company: company.name,
        total_accounts: parsed.length,
        orphans: orphans.length,
        by_type: this.countBy(parsed, p => p.type),
        by_grau: this.countBy(parsed, p => `grau_${p.grau}`),
        sample_first: parsed.slice(0, 5),
        sample_last: parsed.slice(-5),
      };
    }

    // === EXECUÇÃO REAL ===
    // 1. Soft-delete tudo da empresa
    await this.prisma.chartOfAccount.updateMany({
      where: { company_id: companyId, metadeleted: false },
      data: { metadeleted: true },
    });

    // 2. Upsert por (company_id, code) — re-aproveita ids existentes
    let created = 0, updated = 0;
    const codeToId: Record<string, string> = {};

    for (const acc of parsed) {
      const existing = await this.prisma.chartOfAccount.findUnique({
        where: { company_id_code: { company_id: companyId, code: acc.code } },
      });
      if (existing) {
        const upd = await this.prisma.chartOfAccount.update({
          where: { id: existing.id },
          data: {
            name: acc.name,
            type: acc.type,
            description: acc.isSintetica ? 'Conta sintética' : null,
            metadeleted: false,
            // parent_id resolvido na 2ª passada
          },
        });
        codeToId[acc.code] = upd.id;
        updated += 1;
      } else {
        const cre = await this.prisma.chartOfAccount.create({
          data: {
            code: acc.code,
            name: acc.name,
            type: acc.type,
            description: acc.isSintetica ? 'Conta sintética' : null,
            company_id: companyId,
          },
        });
        codeToId[acc.code] = cre.id;
        created += 1;
      }
    }

    // 3. Resolve parent_id (2ª passada)
    for (const acc of parsed) {
      if (!acc.parent_code) continue;
      const parentId = codeToId[acc.parent_code];
      if (!parentId) continue;
      await this.prisma.chartOfAccount.update({
        where: { id: codeToId[acc.code] },
        data: { parent_id: parentId },
      });
    }

    await this.audit.log('IMPORT', 'CHART_OF_ACCOUNT', companyId, current.id, {
      created, updated, total: parsed.length,
    });

    return {
      ok: true,
      company: company.name,
      total_accounts: parsed.length,
      created,
      updated,
      orphans: orphans.length,
      by_type: this.countBy(parsed, p => p.type),
    };
  }

  /**
   * Aplica o plano de contas modelo (derivado da Select sem entidades
   * específicas) na empresa. Substitui o atual via mesmo fluxo do importFromXlsx.
   */
  async applyTemplate(companyId: string, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company || company.metadeleted) throw new NotFoundException('Empresa não encontrada.');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const template: Array<{ code: string; name: string; isS: boolean; grau: number; parent_code: string | null }>
      = require('./template.json');

    if (!Array.isArray(template) || template.length === 0) {
      throw new BadRequestException('Modelo padrão não encontrado.');
    }

    // 1. Soft-delete tudo
    await this.prisma.chartOfAccount.updateMany({
      where: { company_id: companyId, metadeleted: false },
      data: { metadeleted: true },
    });

    // 2. Upsert
    const codeToId: Record<string, string> = {};
    let created = 0, updated = 0;
    for (const acc of template) {
      const type = this.inferAccountType(acc.code);
      const existing = await this.prisma.chartOfAccount.findUnique({
        where: { company_id_code: { company_id: companyId, code: acc.code } },
      });
      if (existing) {
        const u = await this.prisma.chartOfAccount.update({
          where: { id: existing.id },
          data: { name: acc.name, type, description: acc.isS ? 'Conta sintética' : null, metadeleted: false, parent_id: null },
        });
        codeToId[acc.code] = u.id;
        updated += 1;
      } else {
        const c = await this.prisma.chartOfAccount.create({
          data: { code: acc.code, name: acc.name, type, description: acc.isS ? 'Conta sintética' : null, company_id: companyId },
        });
        codeToId[acc.code] = c.id;
        created += 1;
      }
    }

    // 3. Resolve parents
    for (const acc of template) {
      if (!acc.parent_code) continue;
      const pid = codeToId[acc.parent_code];
      if (!pid) continue;
      await this.prisma.chartOfAccount.update({ where: { id: codeToId[acc.code] }, data: { parent_id: pid } });
    }

    await this.audit.log('APPLY_TEMPLATE', 'CHART_OF_ACCOUNT', companyId, current.id, {
      total: template.length, created, updated,
    });

    return {
      ok: true,
      company: company.name,
      total_accounts: template.length,
      created, updated,
      message: 'Plano modelo aplicado com sucesso.',
    };
  }

  /**
   * Mapeia o código contábil (raiz) para AccountType do enum Prisma.
   * Padrão Domínio brasileiro:
   *   1.* = Ativo, 2.3.* = PL, 2.* = Passivo, 3.* = Despesas/Custos,
   *   4.* = Receitas, 5.* = Apuração (vai pra PL).
   */
  private inferAccountType(code: string): AccountType {
    if (code.startsWith('1')) return AccountType.ASSET;
    if (code.startsWith('2.3')) return AccountType.EQUITY;
    if (code.startsWith('2')) return AccountType.LIABILITY;
    if (code.startsWith('3')) return AccountType.EXPENSE;
    if (code.startsWith('4')) return AccountType.REVENUE;
    if (code.startsWith('5')) return AccountType.EQUITY; // Apuração de Resultado
    return AccountType.EXPENSE;
  }

  private countBy<T>(arr: T[], keyFn: (x: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of arr) {
      const k = keyFn(x);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }
}

@ApiTags('financial/chart-of-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/chart-of-accounts')
export class ChartOfAccountsController {
  constructor(private service: ChartOfAccountsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateChartOfAccountDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @Profiles(Profile.ADMIN)
  @Post('sync-defaults/:companyId')
  syncDefaults(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.syncDefaults(companyId, user);
  }

  /**
   * Importa um plano de contas (XLSX/XLS) substituindo o atual da empresa.
   * Aceita o arquivo no body como base64 (campo `file_base64`).
   * Use `dry_run: true` pra validar/visualizar sem persistir.
   */
  @Profiles(Profile.ADMIN)
  @Post('import/:companyId')
  importPlan(
    @Param('companyId') companyId: string,
    @Body() body: { file_base64: string; dry_run?: boolean },
    @CurrentUser() user: any,
  ) {
    if (!body?.file_base64) {
      throw new BadRequestException('file_base64 é obrigatório.');
    }
    return this.service.importFromXlsxBase64(
      companyId,
      body.file_base64,
      { dryRun: body.dry_run === true },
      user,
    );
  }

  /**
   * Aplica o plano de contas modelo (derivado da Select) na empresa.
   * Útil pra empresas novas que ainda não têm plano. Substitui o atual.
   */
  @Profiles(Profile.ADMIN)
  @Post('apply-template/:companyId')
  applyTemplate(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.applyTemplate(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChartOfAccountDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

@Module({
  controllers: [ChartOfAccountsController],
  providers: [ChartOfAccountsService],
  exports: [ChartOfAccountsService],
})
export class ChartOfAccountsModule {}
