import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { JournalEntrySource, PaymentStatus, IrpjApurationStatus, RevenueType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Códigos do plano padrão (definidos em default-accounts.ts).
 * Mantenha em sincronia com aquele arquivo.
 */
export const ACCT_CODES = {
  BANCO_MOVIMENTO: '1.1.1.01',
  BANCO_SEGREGADO_APOSTADORES: '1.1.1.02',
  PSP_GATEWAY: '1.1.1.03',
  CLIENTES_RECEBIVEIS: '1.1.2.01',
  FORNECEDORES: '2.1.1.01',
  SALARIOS_A_PAGAR: '2.1.2.01',
  IRPJ_A_RECOLHER: '2.1.4.01',
  CSLL_A_RECOLHER: '2.1.4.02',
  PIS_A_RECOLHER: '2.1.4.03',
  COFINS_A_RECOLHER: '2.1.4.04',
  ISS_A_RECOLHER: '2.1.4.05',
  TAX_LEI14790_A_RECOLHER: '2.1.4.06',
  IRRF_PREMIOS_A_RECOLHER: '2.1.4.07',
  SALDO_APOSTADORES: '2.1.5.01',
  GGR: '4.1.1.01',
  RECEITA_JUROS: '4.1.2.01',
  RECEITA_FINANCEIRA_OUTRAS: '4.1.2.02',
  RECEITA_RECUPERACAO_TRIB: '4.2.01',
  RECEITA_ROYALTIES: '4.2.02',
  RECEITA_REEMBOLSOS: '4.2.03',
  RECEITA_NAO_OP_OUTRAS: '4.2.99',
  DESP_TAX_LEI14790: '5.1.01',
  DESP_PIS: '5.1.02',
  DESP_COFINS: '5.1.03',
  DESP_ISS: '5.1.04',
  DESP_IRPJ: '5.1.05',
  DESP_CSLL: '5.1.06',
  DESP_OUTRAS_OPERACIONAIS: '5.2.99',
};

@Injectable()
export class JournalPostingService {
  private readonly logger = new Logger(JournalPostingService.name);
  constructor(private prisma: PrismaService) {}

  /**
   * Carrega todas as contas da empresa indexadas por código.
   * Retorna função `acc(code)` que joga erro se a conta não estiver no plano.
   */
  private async loadAccountResolver(companyId: string) {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { company_id: companyId, metadeleted: false },
    });
    const byCode = new Map(accounts.map(a => [a.code, a]));
    return (code: string) => {
      const a = byCode.get(code);
      if (!a) throw new BadRequestException(`Conta ${code} não está no plano de contas. Clique em "Sincronizar plano" no menu de Contabilidade.`);
      return a;
    };
  }

  /**
   * Mapeia a natureza contábil (DRE) do recebível para a conta contábil correspondente.
   * Se não houver natureza, usa fallback por revenue_type.
   */
  private revenueAccountCode(args: {
    nature?: { dre_section: string; name: string } | null;
    revenue_type?: RevenueType | null;
  }): string {
    const sec = args.nature?.dre_section;
    const name = args.nature?.name?.toLowerCase() ?? '';
    if (sec === 'RECEITA_FINANCEIRA') {
      if (name.includes('juros') || name.includes('financeir')) return ACCT_CODES.RECEITA_JUROS;
      return ACCT_CODES.RECEITA_FINANCEIRA_OUTRAS;
    }
    if (sec === 'RECEITA_OPERACIONAL') {
      return ACCT_CODES.GGR;
    }
    // Fallback por revenue_type quando não houver natureza definida.
    if (args.revenue_type === RevenueType.OPERATIONAL) return ACCT_CODES.GGR;
    if (name.includes('royalt')) return ACCT_CODES.RECEITA_ROYALTIES;
    if (name.includes('recupera')) return ACCT_CODES.RECEITA_RECUPERACAO_TRIB;
    if (name.includes('reemb')) return ACCT_CODES.RECEITA_REEMBOLSOS;
    return ACCT_CODES.RECEITA_NAO_OP_OUTRAS;
  }

  /**
   * Cria ou atualiza um lançamento por (source, source_id), idempotente.
   * Apaga as partidas antigas e regrava conforme `lines`.
   */
  private async upsertEntry(args: {
    company_id: string;
    brand_id?: string | null;
    date: Date;
    description: string;
    reference?: string | null;
    source: JournalEntrySource;
    source_id: string;
    lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[];
  }) {
    const totalDebit = args.lines.reduce((s, l) => s + (l.debit ?? 0n), 0n);
    const totalCredit = args.lines.reduce((s, l) => s + (l.credit ?? 0n), 0n);
    if (totalDebit !== totalCredit) {
      throw new Error(`Lançamento desbalanceado para ${args.source} ${args.source_id}: D=${totalDebit} C=${totalCredit}`);
    }
    if (totalDebit === 0n) {
      // Nada a registrar — remove qualquer lançamento prévio.
      await this.prisma.journalEntry.updateMany({
        where: { source: args.source, source_id: args.source_id, metadeleted: false },
        data: { metadeleted: true },
      });
      return null;
    }

    const existing = await this.prisma.journalEntry.findFirst({
      where: { source: args.source, source_id: args.source_id, metadeleted: false },
    });

    const data: any = {
      date: args.date,
      description: args.description,
      reference: args.reference ?? null,
      total_amount: totalDebit,
      posted: true,
      posted_at: new Date(),
      brand_id: args.brand_id ?? null,
    };

    if (existing) {
      await this.prisma.journalEntryLine.deleteMany({ where: { entry_id: existing.id } });
      const updated = await this.prisma.journalEntry.update({
        where: { id: existing.id },
        data: {
          ...data,
          lines: { create: args.lines.map(l => ({
            account_id: l.account_id,
            debit_amount: l.debit ?? 0n,
            credit_amount: l.credit ?? 0n,
            description: l.description,
          })) },
        },
      });
      return updated;
    }

    return this.prisma.journalEntry.create({
      data: {
        ...data,
        company_id: args.company_id,
        source: args.source,
        source_id: args.source_id,
        lines: { create: args.lines.map(l => ({
          account_id: l.account_id,
          debit_amount: l.debit ?? 0n,
          credit_amount: l.credit ?? 0n,
          description: l.description,
        })) },
      },
    });
  }

  // ===================== GGR Diário =====================

  /**
   * Lançamento contábil diário consolidado por marca (princípio do agente):
   *  - Depósitos:   D Banco Segregado / C Saldo Apostadores
   *  - Saques:      D Saldo Apostadores / C Banco Segregado
   *  - GGR (≥0):    D Saldo Apostadores / C Receita GGR
   *  - GGR (<0):    D Receita GGR / C Saldo Apostadores
   * Tudo num único JournalEntry balanceado.
   */
  async postGgrDaily(recordId: string) {
    const r = await this.prisma.ggrDailyRecord.findUnique({
      where: { id: recordId },
      include: { brand: true },
    });
    if (!r || r.metadeleted) return null;
    const acc = await this.loadAccountResolver(r.company_id);
    const apostadores = acc(ACCT_CODES.SALDO_APOSTADORES);
    const ggrAcc = acc(ACCT_CODES.GGR);
    const bancoSegregado = acc(ACCT_CODES.BANCO_SEGREGADO_APOSTADORES);

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [];

    if (r.total_deposits > 0n) {
      lines.push({ account_id: bancoSegregado.id, debit: r.total_deposits, description: 'Depósitos do dia' });
      lines.push({ account_id: apostadores.id, credit: r.total_deposits, description: 'Depósitos do dia' });
    }
    if (r.total_withdrawals > 0n) {
      lines.push({ account_id: apostadores.id, debit: r.total_withdrawals, description: 'Saques do dia' });
      lines.push({ account_id: bancoSegregado.id, credit: r.total_withdrawals, description: 'Saques do dia' });
    }
    const ggrAmount = r.ggr;
    if (ggrAmount > 0n) {
      lines.push({ account_id: apostadores.id, debit: ggrAmount, description: 'GGR (apostas − prêmios)' });
      lines.push({ account_id: ggrAcc.id, credit: ggrAmount, description: 'GGR (apostas − prêmios)' });
    } else if (ggrAmount < 0n) {
      const abs = -ggrAmount;
      lines.push({ account_id: ggrAcc.id, debit: abs, description: 'GGR negativo (prêmios > apostas)' });
      lines.push({ account_id: apostadores.id, credit: abs, description: 'GGR negativo' });
    }

    return this.upsertEntry({
      company_id: r.company_id,
      brand_id: r.brand_id,
      date: r.date,
      description: `Operação do dia · ${r.brand?.name ?? ''} · ${r.date.toISOString().slice(0, 10)}`,
      reference: r.source_reference ?? null,
      source: JournalEntrySource.GGR_DAILY,
      source_id: r.id,
      lines,
    });
  }

  // ===================== Payable PAID =====================

  async postPayablePaid(payableId: string) {
    const p = await this.prisma.accountPayable.findUnique({
      where: { id: payableId },
      include: { nature: true },
    });
    if (!p || p.metadeleted) return null;
    if (p.duplicate_of_id) return null; // duplicatas não geram lançamento
    if (p.status !== PaymentStatus.PAID && p.status !== PaymentStatus.PARTIAL) return null;
    if (!p.payment_date) return null;

    const tx = await this.prisma.transaction.findFirst({
      where: { payable_id: p.id, metadeleted: false },
      orderBy: { date: 'asc' },
      include: { bank_account: true },
    });
    if (!tx) return null;

    const acc = await this.loadAccountResolver(p.company_id);

    // Conta de débito: depende do source/nature
    let debitAccountCode = ACCT_CODES.DESP_OUTRAS_OPERACIONAIS;
    let description = `Pagamento · ${p.description}`;

    if (p.source === 'TAX_APURATION') {
      // Tributo a Recolher (D) → Banco (C). A despesa já foi reconhecida no fechamento da apuração.
      if (p.irpj_apuration_id) {
        // Heurística: se a descrição contém IRPJ ou CSLL, usar a conta correspondente;
        // o ideal é separar IRPJ e CSLL em payables distintos (já é assim).
        if (/csll/i.test(p.description)) debitAccountCode = ACCT_CODES.CSLL_A_RECOLHER;
        else debitAccountCode = ACCT_CODES.IRPJ_A_RECOLHER;
      } else if (p.pis_cofins_apuration_id) {
        if (/cofins/i.test(p.description)) debitAccountCode = ACCT_CODES.COFINS_A_RECOLHER;
        else debitAccountCode = ACCT_CODES.PIS_A_RECOLHER;
      } else if (p.iss_apuration_id) {
        debitAccountCode = ACCT_CODES.ISS_A_RECOLHER;
      } else if (p.ggr_apuration_id) {
        // tributo Lei 14.790
        debitAccountCode = ACCT_CODES.TAX_LEI14790_A_RECOLHER;
      }
    } else if (p.source === 'PAYROLL') {
      debitAccountCode = ACCT_CODES.SALARIOS_A_PAGAR;
    } else {
      // Despesa operacional comum: D conforme natureza, fallback genérico.
      debitAccountCode = ACCT_CODES.DESP_OUTRAS_OPERACIONAIS;
    }

    const debitAcc = acc(debitAccountCode);

    // Conta de crédito: a conta bancária do pagamento. Se houver mapeamento direto
    // entre BankAccount e ChartOfAccount, usar; caso contrário, "Banco Conta Movimento".
    let creditAccountCode = ACCT_CODES.BANCO_MOVIMENTO;
    if (tx.bank_account?.type === 'PSP_GATEWAY') creditAccountCode = ACCT_CODES.PSP_GATEWAY;
    const creditAcc = acc(creditAccountCode);

    return this.upsertEntry({
      company_id: p.company_id,
      brand_id: p.brand_id,
      date: tx.date,
      description,
      reference: p.document_number ?? null,
      source: JournalEntrySource.PAYABLE_PAID,
      source_id: p.id,
      lines: [
        { account_id: debitAcc.id, debit: tx.amount, description: p.supplier_name ?? '' },
        { account_id: creditAcc.id, credit: tx.amount, description: tx.bank_account?.name ?? '' },
      ],
    });
  }

  // ===================== Receivable ISSUED (regime de competência) =====================

  /**
   * Reconhece a receita no momento da emissão do recebível (CPC 47 — competência).
   * D 1.1.2.01 Clientes/Recebíveis (Ativo) / C Receita-por-natureza
   */
  async postReceivableIssued(receivableId: string) {
    const r = await this.prisma.accountReceivable.findUnique({
      where: { id: receivableId },
      include: { nature: true },
    });
    if (!r || r.metadeleted) return null;
    if (r.status === PaymentStatus.CANCELLED) {
      // Cancelado → remove lançamento prévio.
      return this.upsertEntry({
        company_id: r.company_id, brand_id: r.brand_id,
        date: r.issue_date, description: '',
        source: JournalEntrySource.RECEIVABLE_RECEIVED, // sentinela vazia (lines=[] cancela)
        source_id: `ISSUED_${r.id}`,
        lines: [],
      });
    }

    const acc = await this.loadAccountResolver(r.company_id);
    const clientes = acc(ACCT_CODES.CLIENTES_RECEBIVEIS);
    const receitaCode = this.revenueAccountCode({ nature: r.nature, revenue_type: r.revenue_type });
    const receita = acc(receitaCode);

    return this.upsertEntry({
      company_id: r.company_id,
      brand_id: r.brand_id,
      date: r.issue_date,
      description: `Receita · ${r.description}`,
      reference: r.document_number ?? null,
      source: JournalEntrySource.RECEIVABLE_RECEIVED,  // reutilizamos enum; source_id distingue (`ISSUED_…`)
      source_id: `ISSUED_${r.id}`,
      lines: [
        { account_id: clientes.id, debit: r.amount, description: r.customer_name ?? '' },
        { account_id: receita.id, credit: r.amount, description: r.description },
      ],
    });
  }

  // ===================== Receivable RECEIVED (recebimento — zera Clientes) =====================

  async postReceivableReceived(receivableId: string) {
    const r = await this.prisma.accountReceivable.findUnique({ where: { id: receivableId } });
    if (!r || r.metadeleted) return null;
    if (r.status !== PaymentStatus.PAID && r.status !== PaymentStatus.PARTIAL) return null;
    if (!r.receipt_date) return null;

    const tx = await this.prisma.transaction.findFirst({
      where: { receivable_id: r.id, metadeleted: false },
      orderBy: { date: 'asc' },
      include: { bank_account: true },
    });
    if (!tx) return null;

    const acc = await this.loadAccountResolver(r.company_id);
    const banco = acc(tx.bank_account?.type === 'PSP_GATEWAY' ? ACCT_CODES.PSP_GATEWAY : ACCT_CODES.BANCO_MOVIMENTO);
    const clientes = acc(ACCT_CODES.CLIENTES_RECEBIVEIS);

    return this.upsertEntry({
      company_id: r.company_id,
      brand_id: r.brand_id,
      date: tx.date,
      description: `Recebimento · ${r.description}`,
      reference: r.document_number ?? null,
      source: JournalEntrySource.RECEIVABLE_RECEIVED,
      source_id: r.id,
      lines: [
        { account_id: banco.id, debit: tx.amount, description: tx.bank_account?.name ?? '' },
        { account_id: clientes.id, credit: tx.amount, description: r.customer_name ?? '' },
      ],
    });
  }

  // ===================== Tax Apuration CLOSED =====================

  async postIrpjCsllClose(apurationId: string) {
    const a = await this.prisma.irpjCsllApuration.findUnique({ where: { id: apurationId } });
    if (!a || a.metadeleted) return null;
    if (a.status === IrpjApurationStatus.OPEN) return null;
    const acc = await this.loadAccountResolver(a.company_id);
    const periodLabel = a.period_type === 'TRIMESTRAL' && a.quarter
      ? `${a.quarter}T/${a.year}`
      : `${String(a.month).padStart(2, '0')}/${a.year}`;

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [];
    if (a.irpj_total > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_IRPJ).id, debit: a.irpj_total, description: `IRPJ ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.IRPJ_A_RECOLHER).id, credit: a.irpj_total });
    }
    if (a.csll_amount > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_CSLL).id, debit: a.csll_amount, description: `CSLL ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.CSLL_A_RECOLHER).id, credit: a.csll_amount });
    }

    return this.upsertEntry({
      company_id: a.company_id,
      date: a.closed_at ?? new Date(),
      description: `Provisão IRPJ/CSLL · ${periodLabel}`,
      source: JournalEntrySource.TAX_APURATION,
      source_id: `IRPJ_${a.id}`,
      lines,
    });
  }

  async postPisCofinsClose(apurationId: string) {
    const a = await this.prisma.pisCofinsApuration.findUnique({ where: { id: apurationId } });
    if (!a || a.metadeleted) return null;
    if (a.status === 'OPEN') return null;
    const acc = await this.loadAccountResolver(a.company_id);
    const periodLabel = `${String(a.month).padStart(2, '0')}/${a.year}`;

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [];
    if (a.pis_amount_payable > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_PIS).id, debit: a.pis_amount_payable, description: `PIS ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.PIS_A_RECOLHER).id, credit: a.pis_amount_payable });
    }
    if (a.cofins_amount_payable > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_COFINS).id, debit: a.cofins_amount_payable, description: `COFINS ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.COFINS_A_RECOLHER).id, credit: a.cofins_amount_payable });
    }

    return this.upsertEntry({
      company_id: a.company_id,
      date: a.closed_at ?? new Date(),
      description: `Provisão PIS/COFINS · ${periodLabel}`,
      source: JournalEntrySource.TAX_APURATION,
      source_id: `PIS_COFINS_${a.id}`,
      lines,
    });
  }

  async postIssClose(apurationId: string) {
    const a = await this.prisma.issApuration.findUnique({ where: { id: apurationId } });
    if (!a || a.metadeleted) return null;
    if (a.status === 'OPEN') return null;
    const acc = await this.loadAccountResolver(a.company_id);
    const periodLabel = `${String(a.month).padStart(2, '0')}/${a.year}`;

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [];
    if (a.iss_amount > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_ISS).id, debit: a.iss_amount, description: `ISS ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.ISS_A_RECOLHER).id, credit: a.iss_amount });
    }

    return this.upsertEntry({
      company_id: a.company_id,
      date: a.closed_at ?? new Date(),
      description: `Provisão ISS · ${periodLabel}`,
      source: JournalEntrySource.TAX_APURATION,
      source_id: `ISS_${a.id}`,
      lines,
    });
  }

  async postGgrApurationTaxes(apurationId: string) {
    const a = await this.prisma.ggrMonthlyApuration.findUnique({ where: { id: apurationId } });
    if (!a || a.metadeleted) return null;
    if (a.status === 'OPEN') return null;
    const acc = await this.loadAccountResolver(a.company_id);
    const periodLabel = `${String(a.month).padStart(2, '0')}/${a.year}`;

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [];
    if (a.tax_lei14790_amount > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_TAX_LEI14790).id, debit: a.tax_lei14790_amount, description: `Tributo Lei 14.790 ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.TAX_LEI14790_A_RECOLHER).id, credit: a.tax_lei14790_amount });
    }
    if (a.irrf_amount > 0n) {
      lines.push({ account_id: acc(ACCT_CODES.DESP_TAX_LEI14790).id, debit: a.irrf_amount, description: `IRRF Prêmios ${periodLabel}` });
      lines.push({ account_id: acc(ACCT_CODES.IRRF_PREMIOS_A_RECOLHER).id, credit: a.irrf_amount });
    }

    return this.upsertEntry({
      company_id: a.company_id,
      brand_id: a.brand_id,
      date: a.closed_at ?? new Date(),
      description: `Provisão tributos GGR · ${periodLabel}`,
      source: JournalEntrySource.TAX_APURATION,
      source_id: `GGR_${a.id}`,
      lines,
    });
  }

  // ===================== Reprocess =====================

  async reprocessPeriod(args: { company_id: string; from: Date; to: Date }) {
    const { company_id, from, to } = args;
    const result = { ggr: 0, payables: 0, receivables: 0, taxes: 0, errors: [] as string[] };

    const tryRun = async (label: string, fn: () => Promise<any>) => {
      try { await fn(); return true; }
      catch (e: any) { result.errors.push(`${label}: ${e?.message ?? e}`); return false; }
    };

    // GGR diário
    const ggrs = await this.prisma.ggrDailyRecord.findMany({
      where: { company_id, metadeleted: false, date: { gte: from, lte: to } },
      select: { id: true },
    });
    for (const g of ggrs) {
      if (await tryRun(`GGR ${g.id}`, () => this.postGgrDaily(g.id))) result.ggr++;
    }

    // Payables PAID
    const payables = await this.prisma.accountPayable.findMany({
      where: {
        company_id, metadeleted: false, duplicate_of_id: null,
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
        payment_date: { gte: from, lte: to },
      },
      select: { id: true },
    });
    for (const p of payables) {
      if (await tryRun(`Payable ${p.id}`, () => this.postPayablePaid(p.id))) result.payables++;
    }

    // Receivables ISSUED — regime de competência (todos exceto cancelados, por data de emissão)
    const issuedReceivables = await this.prisma.accountReceivable.findMany({
      where: {
        company_id, metadeleted: false,
        issue_date: { gte: from, lte: to },
      },
      select: { id: true },
    });
    for (const r of issuedReceivables) {
      if (await tryRun(`Receivable issued ${r.id}`, () => this.postReceivableIssued(r.id))) result.receivables++;
    }

    // Receivables RECEIVED — recebimento (D Banco / C Clientes)
    const receivedReceivables = await this.prisma.accountReceivable.findMany({
      where: {
        company_id, metadeleted: false,
        status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
        receipt_date: { gte: from, lte: to },
      },
      select: { id: true },
    });
    for (const r of receivedReceivables) {
      if (await tryRun(`Receivable received ${r.id}`, () => this.postReceivableReceived(r.id))) result.receivables++;
    }

    // Apurações fechadas no período
    const irpjs = await this.prisma.irpjCsllApuration.findMany({
      where: { company_id, metadeleted: false, status: { in: ['CLOSED', 'PAID'] }, closed_at: { gte: from, lte: to } },
      select: { id: true },
    });
    for (const a of irpjs) if (await tryRun(`IRPJ ${a.id}`, () => this.postIrpjCsllClose(a.id))) result.taxes++;

    const piss = await this.prisma.pisCofinsApuration.findMany({
      where: { company_id, metadeleted: false, status: { in: ['CLOSED', 'PAID'] }, closed_at: { gte: from, lte: to } },
      select: { id: true },
    });
    for (const a of piss) if (await tryRun(`PIS/COFINS ${a.id}`, () => this.postPisCofinsClose(a.id))) result.taxes++;

    const iss = await this.prisma.issApuration.findMany({
      where: { company_id, metadeleted: false, status: { in: ['CLOSED', 'PAID'] }, closed_at: { gte: from, lte: to } },
      select: { id: true },
    });
    for (const a of iss) if (await tryRun(`ISS ${a.id}`, () => this.postIssClose(a.id))) result.taxes++;

    const ggrApur = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id, metadeleted: false, status: { in: ['CLOSED', 'PAID'] }, closed_at: { gte: from, lte: to } },
      select: { id: true },
    });
    for (const a of ggrApur) if (await tryRun(`GGR Apuração ${a.id}`, () => this.postGgrApurationTaxes(a.id))) result.taxes++;

    return result;
  }
}
