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
  // Retenções CSRF sobre serviços tomados de PJ (substituição tributária)
  IRRF_RETIDO_FONTE_A_RECOLHER:   '2.1.4.08',
  CSLL_RETIDA_FONTE_A_RECOLHER:   '2.1.4.09',
  PIS_RETIDO_FONTE_A_RECOLHER:    '2.1.4.10',
  COFINS_RETIDO_FONTE_A_RECOLHER: '2.1.4.11',
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
   * Resolve uma regra contábil parametrizada (escritório) pelo event_key.
   * Se a regra estiver inativa ou faltando o código, cai no fallback hard-coded.
   * Retorna apenas os códigos — quem chama resolve para ChartOfAccount via `acc()`.
   */
  private async resolveRule(
    eventKey: string,
    fallback: { debit?: string; credit?: string } = {},
  ): Promise<{ debit_code?: string; credit_code?: string; historic_code?: number | null; historic_template?: string | null }> {
    const r = await this.prisma.accountingRule.findUnique({ where: { event_key: eventKey } });
    if (!r || !r.active || r.metadeleted) {
      return { debit_code: fallback.debit, credit_code: fallback.credit };
    }
    return {
      debit_code: r.debit_code ?? fallback.debit,
      credit_code: r.credit_code ?? fallback.credit,
      historic_code: r.historic_code,
      historic_template: r.historic_template,
    };
  }

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
   * Mapeia a natureza contábil (DRE) do recebível para o event_key da regra
   * de receita correspondente (parametrizável em accounting_rules).
   */
  private revenueEventKey(args: {
    nature?: { dre_section: string; name: string } | null;
    revenue_type?: RevenueType | null;
  }): { key: string; fallback: string } {
    const sec = args.nature?.dre_section;
    const name = args.nature?.name?.toLowerCase() ?? '';
    if (sec === 'RECEITA_FINANCEIRA') {
      if (name.includes('juros') || name.includes('financeir'))
        return { key: 'RECEIVABLE_ISSUED.REVENUE_FINANCEIRA_JUROS', fallback: ACCT_CODES.RECEITA_JUROS };
      return { key: 'RECEIVABLE_ISSUED.REVENUE_FINANCEIRA_OUTRAS', fallback: ACCT_CODES.RECEITA_FINANCEIRA_OUTRAS };
    }
    if (sec === 'RECEITA_OPERACIONAL') {
      return { key: 'RECEIVABLE_ISSUED.REVENUE_OPERATIONAL', fallback: ACCT_CODES.GGR };
    }
    if (args.revenue_type === RevenueType.OPERATIONAL)
      return { key: 'RECEIVABLE_ISSUED.REVENUE_OPERATIONAL', fallback: ACCT_CODES.GGR };
    if (name.includes('royalt'))
      return { key: 'RECEIVABLE_ISSUED.REVENUE_ROYALTIES', fallback: ACCT_CODES.RECEITA_ROYALTIES };
    if (name.includes('recupera'))
      return { key: 'RECEIVABLE_ISSUED.REVENUE_RECUPERACAO_TRIB', fallback: ACCT_CODES.RECEITA_RECUPERACAO_TRIB };
    if (name.includes('reemb'))
      return { key: 'RECEIVABLE_ISSUED.REVENUE_REEMBOLSOS', fallback: ACCT_CODES.RECEITA_REEMBOLSOS };
    return { key: 'RECEIVABLE_ISSUED.REVENUE_OUTROS', fallback: ACCT_CODES.RECEITA_NAO_OP_OUTRAS };
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

    const ruleDep = await this.resolveRule('GGR_DAILY.DEPOSIT', { debit: ACCT_CODES.BANCO_SEGREGADO_APOSTADORES, credit: ACCT_CODES.SALDO_APOSTADORES });
    const ruleWith = await this.resolveRule('GGR_DAILY.WITHDRAWAL', { debit: ACCT_CODES.SALDO_APOSTADORES, credit: ACCT_CODES.BANCO_SEGREGADO_APOSTADORES });
    const rulePos = await this.resolveRule('GGR_DAILY.GGR_POSITIVE', { debit: ACCT_CODES.SALDO_APOSTADORES, credit: ACCT_CODES.GGR });
    const ruleNeg = await this.resolveRule('GGR_DAILY.GGR_NEGATIVE', { debit: ACCT_CODES.GGR, credit: ACCT_CODES.SALDO_APOSTADORES });

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [];

    if (r.total_deposits > 0n) {
      lines.push({ account_id: acc(ruleDep.debit_code!).id, debit: r.total_deposits, description: 'Depósitos do dia' });
      lines.push({ account_id: acc(ruleDep.credit_code!).id, credit: r.total_deposits, description: 'Depósitos do dia' });
    }
    if (r.total_withdrawals > 0n) {
      lines.push({ account_id: acc(ruleWith.debit_code!).id, debit: r.total_withdrawals, description: 'Saques do dia' });
      lines.push({ account_id: acc(ruleWith.credit_code!).id, credit: r.total_withdrawals, description: 'Saques do dia' });
    }
    const ggrAmount = r.ggr;
    if (ggrAmount > 0n) {
      lines.push({ account_id: acc(rulePos.debit_code!).id, debit: ggrAmount, description: 'GGR (apostas − prêmios)' });
      lines.push({ account_id: acc(rulePos.credit_code!).id, credit: ggrAmount, description: 'GGR (apostas − prêmios)' });
    } else if (ggrAmount < 0n) {
      const abs = -ggrAmount;
      lines.push({ account_id: acc(ruleNeg.debit_code!).id, debit: abs, description: 'GGR negativo (prêmios > apostas)' });
      lines.push({ account_id: acc(ruleNeg.credit_code!).id, credit: abs, description: 'GGR negativo' });
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

    // Conta de débito: depende do source/nature. Cada caso vai a uma regra parametrizável.
    let debitRuleKey = 'PAYABLE_PAID.SERVICE_OPERATIONAL';
    let debitFallback = ACCT_CODES.DESP_OUTRAS_OPERACIONAIS;
    const description = `Pagamento · ${p.description}`;

    if (p.source === 'TAX_APURATION') {
      if (p.irpj_apuration_id) {
        if (/csll/i.test(p.description)) { debitRuleKey = 'PAYABLE_PAID.TAX_CSLL'; debitFallback = ACCT_CODES.CSLL_A_RECOLHER; }
        else { debitRuleKey = 'PAYABLE_PAID.TAX_IRPJ'; debitFallback = ACCT_CODES.IRPJ_A_RECOLHER; }
      } else if (p.pis_cofins_apuration_id) {
        if (/cofins/i.test(p.description)) { debitRuleKey = 'PAYABLE_PAID.TAX_COFINS'; debitFallback = ACCT_CODES.COFINS_A_RECOLHER; }
        else { debitRuleKey = 'PAYABLE_PAID.TAX_PIS'; debitFallback = ACCT_CODES.PIS_A_RECOLHER; }
      } else if (p.iss_apuration_id) {
        debitRuleKey = 'PAYABLE_PAID.TAX_ISS'; debitFallback = ACCT_CODES.ISS_A_RECOLHER;
      } else if (p.ggr_apuration_id) {
        debitRuleKey = 'PAYABLE_PAID.TAX_LEI14790'; debitFallback = ACCT_CODES.TAX_LEI14790_A_RECOLHER;
      } else if (/Reten[çc][ãa]o\s+CSRF/i.test(p.description)) {
        if (/IRRF/i.test(p.description))         { debitRuleKey = 'PAYABLE_PAID.CSRF_IRRF';   debitFallback = ACCT_CODES.IRRF_RETIDO_FONTE_A_RECOLHER; }
        else if (/CSLL/i.test(p.description))    { debitRuleKey = 'PAYABLE_PAID.CSRF_CSLL';   debitFallback = ACCT_CODES.CSLL_RETIDA_FONTE_A_RECOLHER; }
        else if (/COFINS/i.test(p.description))  { debitRuleKey = 'PAYABLE_PAID.CSRF_COFINS'; debitFallback = ACCT_CODES.COFINS_RETIDO_FONTE_A_RECOLHER; }
        else if (/\bPIS\b/i.test(p.description)) { debitRuleKey = 'PAYABLE_PAID.CSRF_PIS';    debitFallback = ACCT_CODES.PIS_RETIDO_FONTE_A_RECOLHER; }
      }
    } else if (p.source === 'PAYROLL') {
      debitRuleKey = 'PAYABLE_PAID.PAYROLL'; debitFallback = ACCT_CODES.SALARIOS_A_PAGAR;
    }

    const debitRule = await this.resolveRule(debitRuleKey, { debit: debitFallback });
    const debitAcc = acc(debitRule.debit_code!);

    // Conta de crédito: contrapartida bancária parametrizada (BANK.MOVIMENTO ou BANK.PSP_GATEWAY).
    const bankRuleKey = tx.bank_account?.type === 'PSP_GATEWAY' ? 'BANK.PSP_GATEWAY' : 'BANK.MOVIMENTO';
    const bankFallback = tx.bank_account?.type === 'PSP_GATEWAY' ? ACCT_CODES.PSP_GATEWAY : ACCT_CODES.BANCO_MOVIMENTO;
    const bankRule = await this.resolveRule(bankRuleKey, { credit: bankFallback, debit: bankFallback });
    const creditAcc = acc(bankRule.credit_code ?? bankRule.debit_code!);

    // === Retenções federais (CSRF) sobre serviços tomados de PJ ===
    // Quando o pagamento envolve retenção, a despesa é reconhecida pelo BRUTO,
    // o banco sai pelo LÍQUIDO, e a diferença vira passivo (4 contas de retenção).
    //   D Despesa Operacional      bruto
    //     C Banco                            líquido
    //     C IRRF s/ Serviços a Recolher       irrf_retained
    //     C CSLL Retida a Recolher            csll_retained
    //     C PIS Retido a Recolher             pis_retained
    //     C COFINS Retido a Recolher          cofins_retained
    const isPj = (p as any).is_service_from_pj === true;
    const irrfRet   = isPj ? BigInt((p as any).irrf_retained ?? 0)   : 0n;
    const csllRet   = isPj ? BigInt((p as any).csll_retained ?? 0)   : 0n;
    const pisRet    = isPj ? BigInt((p as any).pis_retained ?? 0)    : 0n;
    const cofinsRet = isPj ? BigInt((p as any).cofins_retained ?? 0) : 0n;
    const totalRet  = irrfRet + csllRet + pisRet + cofinsRet;
    // Para pagamentos parciais, usa o tx.amount como crédito de banco e mantém
    // a despesa também proporcional (reconhece ao longo do tempo). No caso PAID
    // total, débito da despesa = bruto = tx.amount + totalRet.
    const grossDebit = tx.amount + totalRet;

    const lines: { account_id: string; debit?: bigint; credit?: bigint; description?: string }[] = [
      { account_id: debitAcc.id,  debit:  grossDebit, description: p.supplier_name ?? '' },
      { account_id: creditAcc.id, credit: tx.amount,  description: tx.bank_account?.name ?? '' },
    ];
    if (irrfRet > 0n) {
      const ret = await this.resolveRule('PAYABLE_PAID.RETENTION_IRRF', { credit: ACCT_CODES.IRRF_RETIDO_FONTE_A_RECOLHER });
      lines.push({ account_id: acc(ret.credit_code!).id, credit: irrfRet, description: 'IRRF retido na fonte (1,5%)' });
    }
    if (csllRet > 0n) {
      const ret = await this.resolveRule('PAYABLE_PAID.RETENTION_CSLL', { credit: ACCT_CODES.CSLL_RETIDA_FONTE_A_RECOLHER });
      lines.push({ account_id: acc(ret.credit_code!).id, credit: csllRet, description: 'CSLL retida na fonte (1%)' });
    }
    if (pisRet > 0n) {
      const ret = await this.resolveRule('PAYABLE_PAID.RETENTION_PIS', { credit: ACCT_CODES.PIS_RETIDO_FONTE_A_RECOLHER });
      lines.push({ account_id: acc(ret.credit_code!).id, credit: pisRet, description: 'PIS retido na fonte (0,65%)' });
    }
    if (cofinsRet > 0n) {
      const ret = await this.resolveRule('PAYABLE_PAID.RETENTION_COFINS', { credit: ACCT_CODES.COFINS_RETIDO_FONTE_A_RECOLHER });
      lines.push({ account_id: acc(ret.credit_code!).id, credit: cofinsRet, description: 'COFINS retido na fonte (3%)' });
    }

    return this.upsertEntry({
      company_id: p.company_id,
      brand_id: p.brand_id,
      date: tx.date,
      description,
      reference: p.document_number ?? null,
      source: JournalEntrySource.PAYABLE_PAID,
      source_id: p.id,
      lines,
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
    const debitRule = await this.resolveRule('RECEIVABLE_ISSUED.BASE_DEBIT', { debit: ACCT_CODES.CLIENTES_RECEBIVEIS });
    const clientes = acc(debitRule.debit_code!);
    const evt = this.revenueEventKey({ nature: r.nature, revenue_type: r.revenue_type });
    const receitaRule = await this.resolveRule(evt.key, { credit: evt.fallback });
    const receita = acc(receitaRule.credit_code!);

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
    const bankRuleKey = tx.bank_account?.type === 'PSP_GATEWAY' ? 'BANK.PSP_GATEWAY' : 'BANK.MOVIMENTO';
    const bankFallback = tx.bank_account?.type === 'PSP_GATEWAY' ? ACCT_CODES.PSP_GATEWAY : ACCT_CODES.BANCO_MOVIMENTO;
    const bankRule = await this.resolveRule(bankRuleKey, { debit: bankFallback });
    const banco = acc(bankRule.debit_code ?? bankRule.credit_code!);
    const clientesRule = await this.resolveRule('RECEIVABLE_RECEIVED.BASE_CREDIT', { credit: ACCT_CODES.CLIENTES_RECEBIVEIS });
    const clientes = acc(clientesRule.credit_code!);

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
      const rule = await this.resolveRule('TAX_CLOSE.IRPJ', { debit: ACCT_CODES.DESP_IRPJ, credit: ACCT_CODES.IRPJ_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.irpj_total, description: `IRPJ ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.irpj_total });
    }
    if (a.csll_amount > 0n) {
      const rule = await this.resolveRule('TAX_CLOSE.CSLL', { debit: ACCT_CODES.DESP_CSLL, credit: ACCT_CODES.CSLL_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.csll_amount, description: `CSLL ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.csll_amount });
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
      const rule = await this.resolveRule('TAX_CLOSE.PIS', { debit: ACCT_CODES.DESP_PIS, credit: ACCT_CODES.PIS_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.pis_amount_payable, description: `PIS ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.pis_amount_payable });
    }
    if (a.cofins_amount_payable > 0n) {
      const rule = await this.resolveRule('TAX_CLOSE.COFINS', { debit: ACCT_CODES.DESP_COFINS, credit: ACCT_CODES.COFINS_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.cofins_amount_payable, description: `COFINS ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.cofins_amount_payable });
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
      const rule = await this.resolveRule('TAX_CLOSE.ISS', { debit: ACCT_CODES.DESP_ISS, credit: ACCT_CODES.ISS_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.iss_amount, description: `ISS ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.iss_amount });
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
      const rule = await this.resolveRule('TAX_CLOSE.LEI14790', { debit: ACCT_CODES.DESP_TAX_LEI14790, credit: ACCT_CODES.TAX_LEI14790_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.tax_lei14790_amount, description: `Tributo Lei 14.790 ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.tax_lei14790_amount });
    }
    if (a.irrf_amount > 0n) {
      const rule = await this.resolveRule('TAX_CLOSE.IRRF_PREMIOS', { debit: ACCT_CODES.DESP_TAX_LEI14790, credit: ACCT_CODES.IRRF_PREMIOS_A_RECOLHER });
      lines.push({ account_id: acc(rule.debit_code!).id, debit: a.irrf_amount, description: `IRRF Prêmios ${periodLabel}` });
      lines.push({ account_id: acc(rule.credit_code!).id, credit: a.irrf_amount });
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
