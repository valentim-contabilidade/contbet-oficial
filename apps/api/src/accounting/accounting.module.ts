import {
  Module, Injectable, NotFoundException, BadRequestException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsNumber, IsDateString, MaxLength, MinLength, Min, IsEnum,
  IsArray, ArrayMinSize, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Profile, JournalEntrySource, AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../financial/tenant.helper';
import { serializeBigInt } from '../financial/money.helper';
import { JournalPostingService } from './journal-posting.service';
import { DEFAULT_ACCOUNTING_RULES, syncDefaultAccountingRules } from './default-rules';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../financial/chart-of-accounts/default-accounts';

// ============================== DTOs ==============================

class JournalLineDto {
  @IsString() account_id: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsNumber() @Min(0) debit_amount?: number;
  @IsOptional() @IsNumber() @Min(0) credit_amount?: number;
}

class CreateJournalEntryDto {
  @IsDateString() date: string;
  @IsString() @MinLength(2) @MaxLength(2000) description: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() company_id?: string;
  @IsOptional() @IsString() brand_id?: string;
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

class UpdateJournalEntryDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() brand_id?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines?: JournalLineDto[];
}

// ============================== SERVICE ==============================

@Injectable()
export class AccountingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private posting: JournalPostingService,
  ) {}

  async reprocess(args: { company_id: string; from: string; to: string }, current: any) {
    if (current.profile === 'MANAGER' && current.company_id !== args.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const result = await this.posting.reprocessPeriod({
      company_id: args.company_id,
      from: new Date(args.from),
      to: new Date(args.to),
    });
    await this.audit.log('REPROCESS', 'JOURNAL_ENTRY', args.company_id, current.id, result);
    return result;
  }

  /**
   * Valida partidas dobradas: total D = total C, valor > 0, contas existem na empresa.
   */
  private async validateLines(lines: JournalLineDto[], companyId: string) {
    if (lines.length < 2) throw new BadRequestException('Lançamento precisa ter no mínimo 2 partidas (débito e crédito).');
    let totalDebit = 0;
    let totalCredit = 0;
    const accountIds = new Set<string>();
    for (const l of lines) {
      const debit = l.debit_amount ?? 0;
      const credit = l.credit_amount ?? 0;
      if (debit < 0 || credit < 0) throw new BadRequestException('Valores não podem ser negativos.');
      if (debit > 0 && credit > 0) throw new BadRequestException('Cada partida deve ser apenas débito OU crédito, nunca os dois.');
      if (debit === 0 && credit === 0) throw new BadRequestException('Partida precisa ter valor > 0.');
      totalDebit += debit;
      totalCredit += credit;
      accountIds.add(l.account_id);
    }
    if (totalDebit !== totalCredit) {
      throw new BadRequestException(`Lançamento não bate: débito ${totalDebit} ≠ crédito ${totalCredit}.`);
    }
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: Array.from(accountIds) }, metadeleted: false },
    });
    if (accounts.length !== accountIds.size) throw new BadRequestException('Uma ou mais contas inválidas.');
    for (const a of accounts) {
      if (a.company_id !== companyId) throw new BadRequestException(`Conta ${a.code} não pertence à empresa.`);
    }
    return { totalDebit, totalCredit };
  }

  async create(dto: CreateJournalEntryDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);
    const { totalDebit } = await this.validateLines(dto.lines, company_id);

    const entry = await this.prisma.journalEntry.create({
      data: {
        date: new Date(dto.date),
        description: dto.description,
        reference: dto.reference,
        notes: dto.notes,
        company_id,
        brand_id: dto.brand_id || null,
        source: JournalEntrySource.MANUAL,
        total_amount: BigInt(totalDebit),
        posted: true,
        posted_at: new Date(),
        lines: {
          create: dto.lines.map(l => ({
            account_id: l.account_id,
            description: l.description ?? null,
            debit_amount: BigInt(l.debit_amount ?? 0),
            credit_amount: BigInt(l.credit_amount ?? 0),
          })),
        },
      },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } } },
    });
    await this.audit.log('CREATE', 'JOURNAL_ENTRY', entry.id, current.id);
    return serializeBigInt(entry);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    where.metadeleted = false;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.source) where.source = filters.source;
    if (filters.from || filters.to) {
      where.date = {};
      if (filters.from) where.date.gte = new Date(filters.from);
      if (filters.to) where.date.lte = new Date(filters.to);
    }
    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
        include: {
          brand: { select: { id: true, name: true } },
          lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const e = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        brand: true,
        lines: { include: { account: true } },
      },
    });
    if (!e || e.metadeleted) throw new NotFoundException('Lançamento não encontrado.');
    assertTenantAccess(e, current);
    return serializeBigInt(e);
  }

  async update(id: string, dto: UpdateJournalEntryDto, current: any) {
    const existing = await this.findOne(id, current);
    if (existing.source !== JournalEntrySource.MANUAL) {
      throw new BadRequestException('Apenas lançamentos manuais podem ser editados.');
    }

    const data: any = {};
    if (dto.date) data.date = new Date(dto.date);
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.brand_id !== undefined) data.brand_id = dto.brand_id || null;

    if (dto.lines && dto.lines.length > 0) {
      const { totalDebit } = await this.validateLines(dto.lines, existing.company_id);
      data.total_amount = BigInt(totalDebit);

      // Apaga partidas antigas e recria
      await this.prisma.journalEntryLine.deleteMany({ where: { entry_id: id } });
      data.lines = {
        create: dto.lines.map(l => ({
          account_id: l.account_id,
          description: l.description ?? null,
          debit_amount: BigInt(l.debit_amount ?? 0),
          credit_amount: BigInt(l.credit_amount ?? 0),
        })),
      };
    }

    const updated = await this.prisma.journalEntry.update({
      where: { id }, data,
      include: { lines: { include: { account: true } } },
    });
    await this.audit.log('UPDATE', 'JOURNAL_ENTRY', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    const e = await this.findOne(id, current);
    if (e.source !== JournalEntrySource.MANUAL) {
      throw new BadRequestException('Apenas lançamentos manuais podem ser excluídos.');
    }
    await this.prisma.journalEntry.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'JOURNAL_ENTRY', id, current.id);
    return { ok: true };
  }

  // ===================== Balancete (Trial Balance) =====================

  async trialBalance(filters: any, current: any) {
    const where: any = { metadeleted: false };
    const tenant = buildTenantWhere(current, {}, { allowOwner: false });
    if (tenant.company_id) where.company_id = tenant.company_id;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (!where.company_id) throw new BadRequestException('Selecione a empresa.');

    const start = filters.from ? new Date(filters.from) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const end = filters.to ? new Date(filters.to) : new Date();

    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { company_id: where.company_id, metadeleted: false },
      orderBy: { code: 'asc' },
    });

    // Soma D/C por conta dentro do intervalo
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        entry: {
          company_id: where.company_id,
          metadeleted: false,
          posted: true,
          date: { gte: start, lte: end },
        },
      },
      select: { account_id: true, debit_amount: true, credit_amount: true },
    });

    const totals = new Map<string, { debit: bigint; credit: bigint }>();
    for (const l of lines) {
      const cur = totals.get(l.account_id) ?? { debit: 0n, credit: 0n };
      cur.debit += l.debit_amount;
      cur.credit += l.credit_amount;
      totals.set(l.account_id, cur);
    }

    let totalDebit = 0n;
    let totalCredit = 0n;
    const rows = accounts.map(a => {
      const t = totals.get(a.id) ?? { debit: 0n, credit: 0n };
      totalDebit += t.debit;
      totalCredit += t.credit;
      // Saldo: para Ativo/Despesa, saldo natural é D-C; para Passivo/PL/Receita, C-D.
      const isDebitNatural = a.type === AccountType.ASSET || a.type === AccountType.EXPENSE;
      const balance = isDebitNatural ? t.debit - t.credit : t.credit - t.debit;
      return {
        account_id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        parent_id: a.parent_id,
        debit: t.debit.toString(),
        credit: t.credit.toString(),
        balance: balance.toString(),
        natural_side: isDebitNatural ? 'D' : 'C',
      };
    });

    return serializeBigInt({
      rows,
      total_debit: totalDebit.toString(),
      total_credit: totalCredit.toString(),
      from: start.toISOString(),
      to: end.toISOString(),
    });
  }

  // ===================== DRE Contábil (Demonstração do Resultado) =====================

  /**
   * Monta a DRE estruturada hierarquicamente a partir dos lançamentos contábeis,
   * usando a árvore parent/child do plano de contas. Receita - Despesa = Resultado.
   */
  async incomeStatement(filters: any, current: any) {
    const tb: any = await this.trialBalance(filters, current);
    const rows: any[] = tb.rows;

    // Filtra só REVENUE e EXPENSE; ignora contas zeradas.
    const relevant = rows.filter(r => r.type === 'REVENUE' || r.type === 'EXPENSE');

    // Constrói índice por id e calcula saldo agregado (subtotais via parent_id).
    const byId = new Map<string, any>();
    for (const r of relevant) byId.set(r.account_id, { ...r, children: [] as any[], aggregated: BigInt(r.balance) });
    // Conecta filhos a pais
    const roots: any[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
      else roots.push(node);
    }
    // Soma agregada (post-order)
    const aggregate = (node: any): bigint => {
      const childrenSum = node.children.reduce((s: bigint, c: any) => s + aggregate(c), 0n);
      node.aggregated = BigInt(node.balance) + childrenSum;
      return node.aggregated;
    };
    for (const r of roots) aggregate(r);

    // Achata em ordem de código com indentação por profundidade
    const flat: any[] = [];
    const walk = (n: any, depth: number) => {
      if (n.aggregated === 0n && BigInt(n.balance) === 0n) return; // oculta zeradas
      flat.push({
        account_id: n.account_id,
        code: n.code,
        name: n.name,
        type: n.type,
        depth,
        balance: n.balance,
        aggregated: n.aggregated.toString(),
        is_synthetic: n.children.length > 0,
      });
      n.children
        .slice()
        .sort((a: any, b: any) => a.code.localeCompare(b.code))
        .forEach((c: any) => walk(c, depth + 1));
    };
    roots
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach(r => walk(r, 0));

    // Totais
    const revenueTotal = relevant
      .filter(r => r.type === 'REVENUE' && !r.parent_id)
      .reduce((s, r) => s + (byId.get(r.account_id)?.aggregated ?? 0n), 0n);
    const expenseTotal = relevant
      .filter(r => r.type === 'EXPENSE' && !r.parent_id)
      .reduce((s, r) => s + (byId.get(r.account_id)?.aggregated ?? 0n), 0n);
    // Quando não há raízes (todas as contas têm parent visível), recalcula somando os saldos diretos
    const revenueAlt = relevant
      .filter(r => r.type === 'REVENUE')
      .reduce((s, r) => s + BigInt(r.balance), 0n);
    const expenseAlt = relevant
      .filter(r => r.type === 'EXPENSE')
      .reduce((s, r) => s + BigInt(r.balance), 0n);
    const totalRevenue = revenueTotal !== 0n ? revenueTotal : revenueAlt;
    const totalExpense = expenseTotal !== 0n ? expenseTotal : expenseAlt;
    const netIncome = totalRevenue - totalExpense;

    return {
      rows: flat,
      total_revenue: totalRevenue.toString(),
      total_expense: totalExpense.toString(),
      net_income: netIncome.toString(),
      from: tb.from,
      to: tb.to,
    };
  }

  // ===================== Balanço Patrimonial =====================

  async balanceSheet(filters: any, current: any) {
    const tb: any = await this.trialBalance(filters, current);
    const groups = {
      ATIVO: { total: 0n, items: [] as any[] },
      PASSIVO: { total: 0n, items: [] as any[] },
      PATRIMONIO_LIQUIDO: { total: 0n, items: [] as any[] },
    };

    for (const r of tb.rows) {
      const balance = BigInt(r.balance);
      if (r.type === 'ASSET') {
        groups.ATIVO.items.push(r);
        groups.ATIVO.total += balance;
      } else if (r.type === 'LIABILITY') {
        groups.PASSIVO.items.push(r);
        groups.PASSIVO.total += balance;
      } else if (r.type === 'EQUITY') {
        groups.PATRIMONIO_LIQUIDO.items.push(r);
        groups.PATRIMONIO_LIQUIDO.total += balance;
      }
    }

    // Apura resultado do exercício: receitas - despesas
    let revenueTotal = 0n;
    let expenseTotal = 0n;
    for (const r of tb.rows) {
      const balance = BigInt(r.balance);
      if (r.type === 'REVENUE') revenueTotal += balance;
      if (r.type === 'EXPENSE') expenseTotal += balance;
    }
    const net_income = revenueTotal - expenseTotal;

    return {
      assets_total: groups.ATIVO.total.toString(),
      liabilities_total: groups.PASSIVO.total.toString(),
      equity_total: groups.PATRIMONIO_LIQUIDO.total.toString(),
      net_income: net_income.toString(),
      // Equação contábil: Ativo = Passivo + PL + Resultado do Exercício
      check: (groups.ATIVO.total - groups.PASSIVO.total - groups.PATRIMONIO_LIQUIDO.total - net_income).toString(),
      groups: {
        ATIVO: { total: groups.ATIVO.total.toString(), items: groups.ATIVO.items },
        PASSIVO: { total: groups.PASSIVO.total.toString(), items: groups.PASSIVO.items },
        PATRIMONIO_LIQUIDO: { total: groups.PATRIMONIO_LIQUIDO.total.toString(), items: groups.PATRIMONIO_LIQUIDO.items },
      },
      from: tb.from,
      to: tb.to,
    };
  }
}

// ============================== CONTROLLER ==============================

@ApiTags('accounting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('accounting')
export class AccountingController {
  constructor(private service: AccountingService) {}

  @Profiles(Profile.ADMIN)
  @Post('journal')
  create(@Body() dto: CreateJournalEntryDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Profiles(Profile.ADMIN)
  @Get('journal')
  findAll(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @Profiles(Profile.ADMIN)
  @Get('journal/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Profiles(Profile.ADMIN)
  @Patch('journal/:id')
  update(@Param('id') id: string, @Body() dto: UpdateJournalEntryDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN)
  @Delete('journal/:id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('trial-balance')
  trialBalance(@Query() q: any, @CurrentUser() user: any) {
    return this.service.trialBalance(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('balance-sheet')
  balanceSheet(@Query() q: any, @CurrentUser() user: any) {
    return this.service.balanceSheet(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('income-statement')
  incomeStatement(@Query() q: any, @CurrentUser() user: any) {
    return this.service.incomeStatement(q, user);
  }

  @Profiles(Profile.ADMIN)
  @Post('reprocess')
  reprocess(@Body() dto: { company_id: string; from: string; to: string }, @CurrentUser() user: any) {
    return this.service.reprocess(dto, user);
  }
}

// ============================== Accounting Rules ==============================

class UpdateAccountingRuleDto {
  @IsOptional() @IsString() @MaxLength(20) debit_code?: string | null;
  @IsOptional() @IsString() @MaxLength(20) credit_code?: string | null;
  @IsOptional() @IsNumber() @Min(0) historic_code?: number | null;
  @IsOptional() @IsString() @MaxLength(500) historic_template?: string | null;
  @IsOptional() label?: string;
  @IsOptional() description?: string | null;
  @IsOptional() active?: boolean;
}

@Injectable()
export class AccountingRulesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async findAll() {
    const rules = await this.prisma.accountingRule.findMany({
      where: { metadeleted: false },
      orderBy: [{ group: 'asc' }, { event_key: 'asc' }],
    });
    // Catálogo de contas modelo (default-accounts.ts) — códigos que as regras
    // realmente referenciam. Inclui type pra a UI poder filtrar/colorir.
    const accounts_by_code: Record<string, string> = {};
    const default_accounts = DEFAULT_CHART_OF_ACCOUNTS.map(a => ({
      code: a.code, name: a.name, type: a.type, parent_code: a.parent_code,
    }));
    for (const a of DEFAULT_CHART_OF_ACCOUNTS) accounts_by_code[a.code] = a.name;
    return { data: rules, total: rules.length, accounts_by_code, default_accounts };
  }

  async update(id: string, dto: UpdateAccountingRuleDto, current: any) {
    const r = await this.prisma.accountingRule.findUnique({ where: { id } });
    if (!r || r.metadeleted) throw new NotFoundException('Regra não encontrada.');
    const updated = await this.prisma.accountingRule.update({
      where: { id },
      data: {
        debit_code: dto.debit_code !== undefined ? (dto.debit_code || null) : undefined,
        credit_code: dto.credit_code !== undefined ? (dto.credit_code || null) : undefined,
        historic_code: dto.historic_code !== undefined ? dto.historic_code : undefined,
        historic_template: dto.historic_template !== undefined ? (dto.historic_template || null) : undefined,
        label: dto.label,
        description: dto.description !== undefined ? (dto.description || null) : undefined,
        active: dto.active,
      },
    });
    await this.audit.log('UPDATE', 'ACCOUNTING_RULE', id, current.id, dto);
    return updated;
  }

  async resetToDefault(id: string, current: any) {
    const r = await this.prisma.accountingRule.findUnique({ where: { id } });
    if (!r || r.metadeleted) throw new NotFoundException('Regra não encontrada.');
    const def = DEFAULT_ACCOUNTING_RULES.find(d => d.event_key === r.event_key);
    if (!def) throw new BadRequestException('Não há default no catálogo para esta regra.');
    const updated = await this.prisma.accountingRule.update({
      where: { id },
      data: {
        debit_code: def.debit_code ?? null,
        credit_code: def.credit_code ?? null,
        historic_code: def.historic_code ?? null,
        historic_template: def.historic_template ?? null,
        label: def.label,
        description: def.description ?? null,
        active: true,
      },
    });
    await this.audit.log('RESET', 'ACCOUNTING_RULE', id, current.id);
    return updated;
  }

  async syncDefaults(current: any) {
    const res = await syncDefaultAccountingRules(this.prisma as any);
    await this.audit.log('SYNC', 'ACCOUNTING_RULE', 'catalog', current.id, res);
    return res;
  }
}

@ApiTags('accounting/rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('accounting/rules')
export class AccountingRulesController {
  constructor(private service: AccountingRulesService) {}

  @Profiles(Profile.ADMIN)
  @Get()
  findAll() { return this.service.findAll(); }

  @Profiles(Profile.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccountingRuleDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN)
  @Post(':id/reset')
  reset(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.resetToDefault(id, user);
  }

  @Profiles(Profile.ADMIN)
  @Post('sync-defaults')
  sync(@CurrentUser() user: any) {
    return this.service.syncDefaults(user);
  }
}

@Module({
  controllers: [AccountingController, AccountingRulesController],
  providers: [AccountingService, JournalPostingService, AccountingRulesService],
  exports: [AccountingService, JournalPostingService],
})
export class AccountingModule {}
