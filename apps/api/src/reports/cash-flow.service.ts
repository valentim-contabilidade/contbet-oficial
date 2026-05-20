import { Injectable, BadRequestException } from '@nestjs/common';
import { Profile, PaymentStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeBigInt } from '../financial/money.helper';
import { resolvePeriod, percentage, PeriodType } from './period.helper';

/**
 * Relatório de Fluxo de Caixa — forma DIRETA (gerencial).
 *
 * Saldo inicial + Entradas - Saídas = Saldo final
 *
 * Cobre dois universos:
 *   - REALIZADO: Transactions com type=INCOME/EXPENSE no período
 *   - PROJETADO: AccountReceivable e AccountPayable PENDING/PARTIAL com
 *                due_date dentro do período
 *
 * Agrupa por NATUREZA contábil (DRE) quando disponível, com fallback para
 * "Sem natureza".
 */
export interface CashFlowInput {
  company_id: string;
  brand_id?: string;
  period_type: PeriodType;
  year: number;
  month?: number;
  quarter?: number;
  start_date?: string;
  end_date?: string;
  /** Quando true, inclui contas a pagar/receber pendentes a vencer no período. */
  include_projected?: boolean;
}

interface CashFlowGroup {
  nature_id: string | null;
  nature_name: string;
  dre_section: string | null;
  realized: bigint;
  projected: bigint;
  total: bigint;
}

@Injectable()
export class CashFlowService {
  constructor(private prisma: PrismaService) {}

  async generate(input: CashFlowInput, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== input.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    if (current.profile === Profile.OWNER) {
      if (current.company_id !== input.company_id) {
        throw new BadRequestException('Sem acesso a esta empresa.');
      }
      const allowed: string[] = (current.brand_ids && current.brand_ids.length > 0)
        ? current.brand_ids
        : (current.brand_id ? [current.brand_id] : []);
      if (allowed.length === 0) {
        throw new BadRequestException('Operador sem marca atribuída.');
      }
      if (!input.brand_id) input.brand_id = allowed[0];
      else if (!allowed.includes(input.brand_id)) {
        throw new BadRequestException('Sem acesso a esta marca.');
      }
    }

    const company = await this.prisma.company.findUnique({ where: { id: input.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    const period = resolvePeriod({
      period_type: input.period_type,
      year: input.year,
      month: input.month,
      quarter: input.quarter,
      start_date: input.start_date,
      end_date: input.end_date,
    });

    const baseWhere: any = { company_id: input.company_id, metadeleted: false };
    if (input.brand_id) baseWhere.brand_id = input.brand_id;

    const includeProjected = input.include_projected !== false; // default true

    // ============= ENTRADAS =============

    // Realizado: Transactions type=INCOME no período (independente de receivable)
    const incomeTxs = await this.prisma.transaction.findMany({
      where: {
        ...baseWhere,
        type: TransactionType.INCOME,
        date: { gte: period.start, lt: period.end },
      },
      select: {
        amount: true,
        receivable: {
          select: { nature: { select: { id: true, name: true, dre_section: true } } },
        },
        category: { select: { id: true, name: true } },
      },
    });
    const inflowsRealizedByNature = this.groupByNature(
      incomeTxs.map(t => ({
        amount: t.amount,
        nature: t.receivable?.nature || null,
        fallback_name: t.category?.name || 'Outros recebimentos',
      })),
    );

    // GGR como entrada (receita operacional da casa)
    const ggrSum = await this.prisma.ggrDailyRecord.aggregate({
      where: { ...baseWhere, date: { gte: period.start, lt: period.end } },
      _sum: { ggr: true },
    });
    const ggrAmount = ggrSum._sum.ggr ?? 0n;
    if (ggrAmount > 0n) {
      const existing = inflowsRealizedByNature.find(g => g.nature_name === 'GGR (Receita de Apostas)');
      if (existing) existing.realized += ggrAmount;
      else {
        inflowsRealizedByNature.push({
          nature_id: null, nature_name: 'GGR (Receita de Apostas)', dre_section: 'RECEITA_OPERACIONAL',
          realized: ggrAmount, projected: 0n, total: ggrAmount,
        });
      }
    }

    // Projetado: Receivables PENDING/PARTIAL com vencimento no período
    let inflowsProjectedByNature: CashFlowGroup[] = [];
    if (includeProjected) {
      const pendingReceivables = await this.prisma.accountReceivable.findMany({
        where: {
          ...baseWhere,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
          due_date: { gte: period.start, lt: period.end },
        },
        select: {
          amount: true, received_amount: true,
          nature: { select: { id: true, name: true, dre_section: true } },
        },
      });
      inflowsProjectedByNature = this.groupByNature(
        pendingReceivables.map(r => ({
          amount: r.amount - r.received_amount, // só o que falta receber
          nature: r.nature || null,
          fallback_name: 'Recebimentos pendentes',
        })),
      ).map(g => ({ ...g, projected: g.realized, realized: 0n, total: g.realized }));
    }

    // Merge inflows (realizado + projetado)
    const inflowsByNature = this.mergeByNature(inflowsRealizedByNature, inflowsProjectedByNature);

    // ============= SAÍDAS =============

    // Realizado: Transactions type=EXPENSE no período
    const expenseTxs = await this.prisma.transaction.findMany({
      where: {
        ...baseWhere,
        type: TransactionType.EXPENSE,
        date: { gte: period.start, lt: period.end },
      },
      select: {
        amount: true,
        payable: {
          select: {
            source: true,
            description: true,
            nature: { select: { id: true, name: true, dre_section: true } },
          },
        },
        category: { select: { id: true, name: true } },
      },
    });
    const outflowsRealizedByNature = this.groupByNature(
      expenseTxs.map(t => ({
        amount: t.amount,
        nature: t.payable?.nature || null,
        fallback_name: this.fallbackOutflowName(t.payable, t.category?.name),
      })),
    );

    // Projetado: Payables PENDING/PARTIAL com vencimento no período
    let outflowsProjectedByNature: CashFlowGroup[] = [];
    if (includeProjected) {
      const pendingPayables = await this.prisma.accountPayable.findMany({
        where: {
          ...baseWhere,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
          duplicate_of_id: null,
          due_date: { gte: period.start, lt: period.end },
        },
        select: {
          amount: true, paid_amount: true,
          source: true, description: true,
          nature: { select: { id: true, name: true, dre_section: true } },
        },
      });
      outflowsProjectedByNature = this.groupByNature(
        pendingPayables.map(p => ({
          amount: p.amount - p.paid_amount,
          nature: p.nature || null,
          fallback_name: this.fallbackOutflowName({ source: p.source, description: p.description }, undefined),
        })),
      ).map(g => ({ ...g, projected: g.realized, realized: 0n, total: g.realized }));
    }

    const outflowsByNature = this.mergeByNature(outflowsRealizedByNature, outflowsProjectedByNature);

    // ============= TOTAIS =============

    const totalInflowsRealized  = inflowsByNature.reduce((s, g) => s + g.realized,  0n);
    const totalInflowsProjected = inflowsByNature.reduce((s, g) => s + g.projected, 0n);
    const totalOutflowsRealized = outflowsByNature.reduce((s, g) => s + g.realized,  0n);
    const totalOutflowsProjected= outflowsByNature.reduce((s, g) => s + g.projected, 0n);

    const totalInflows  = totalInflowsRealized  + totalInflowsProjected;
    const totalOutflows = totalOutflowsRealized + totalOutflowsProjected;

    const cashGeneration = totalInflows - totalOutflows;

    // ============= SALDOS =============

    // Saldo atual = soma de todas as bank_accounts (ativas e não-segregadas — exclui carteira de apostadores)
    const bankAccounts = await this.prisma.bankAccount.findMany({
      where: { company_id: input.company_id, metadeleted: false, is_active: true, is_player_wallet: false },
      select: { current_balance: true, name: true },
    });
    const currentBalance = bankAccounts.reduce((s, a) => s + a.current_balance, 0n);

    // Saldo inicial = saldo atual − geração líquida do período (aproximação)
    // Saldo final = saldo inicial + geração de caixa
    // Para simplificar: se o período for passado, current_balance é o saldo final;
    // se for futuro, current_balance é o inicial.
    const isPastPeriod = period.end < new Date();
    const isFuturePeriod = period.start > new Date();
    let initialBalance: bigint;
    let finalBalance: bigint;
    if (isPastPeriod) {
      finalBalance = currentBalance;
      initialBalance = currentBalance - cashGeneration;
    } else if (isFuturePeriod) {
      initialBalance = currentBalance;
      finalBalance = currentBalance + cashGeneration;
    } else {
      // Período corrente — usa current_balance como referência;
      // não dá pra reconstituir o ponto exato sem snapshot histórico.
      initialBalance = currentBalance - (totalInflowsRealized - totalOutflowsRealized);
      finalBalance = initialBalance + cashGeneration;
    }

    // ============= MONTAGEM DA RESPOSTA =============

    return serializeBigInt({
      period: {
        type: input.period_type,
        label: period.label,
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      include_projected: includeProjected,
      summary: {
        initial_balance: initialBalance,
        final_balance: finalBalance,
        cash_generation: cashGeneration,
        total_inflows: totalInflows,
        total_outflows: totalOutflows,
      },
      inflows: {
        realized: totalInflowsRealized,
        projected: totalInflowsProjected,
        groups: inflowsByNature.map(g => ({
          nature_id: g.nature_id, nature_name: g.nature_name, dre_section: g.dre_section,
          realized: g.realized, projected: g.projected, total: g.total,
          percent_of_inflows: percentage(g.total, totalInflows),
        })).sort((a, b) => Number(b.total - a.total)),
      },
      outflows: {
        realized: totalOutflowsRealized,
        projected: totalOutflowsProjected,
        groups: outflowsByNature.map(g => ({
          nature_id: g.nature_id, nature_name: g.nature_name, dre_section: g.dre_section,
          realized: g.realized, projected: g.projected, total: g.total,
          percent_of_outflows: percentage(g.total, totalOutflows),
        })).sort((a, b) => Number(b.total - a.total)),
      },
      bank_accounts: bankAccounts.map(a => ({ name: a.name, current_balance: a.current_balance })),
    });
  }

  /**
   * Quando o payable não tem nature_id, usamos o source/descrição para gerar um
   * nome legível. DARFs (TAX_APURATION) viram buckets nomeados pelo tributo.
   */
  private fallbackOutflowName(
    payable: { source: string | null; description: string | null } | null | undefined,
    categoryName: string | undefined,
  ): string {
    if (!payable) return categoryName || 'Outras saídas';
    if (payable.source === 'TAX_APURATION') {
      const desc = (payable.description || '').toLowerCase();
      if (desc.includes('retenção csrf')) return 'Retenções CSRF (PJ→PJ)';
      if (desc.includes('lei 14.790') || desc.includes('lei14790')) return 'Tributo Lei 14.790';
      if (desc.includes('cofins')) return 'COFINS';
      if (desc.includes('pis')) return 'PIS';
      if (desc.includes('iss')) return 'ISS';
      if (desc.includes('csll')) return 'CSLL';
      if (desc.includes('irpj')) return 'IRPJ';
      return 'Tributos federais';
    }
    if (payable.source === 'PAYROLL') return 'Folha de pagamento';
    return categoryName || 'Outras saídas';
  }

  /**
   * Agrupa lançamentos por natureza contábil (com fallback para nome).
   * Retorna array com `realized` populado (a função consumidora ajusta para projected/realized).
   */
  private groupByNature(items: Array<{ amount: bigint; nature: { id: string; name: string; dre_section: string } | null; fallback_name: string }>): CashFlowGroup[] {
    const map = new Map<string, CashFlowGroup>();
    for (const item of items) {
      const key = item.nature?.id ?? `_${item.fallback_name}`;
      const name = item.nature?.name ?? item.fallback_name;
      const sec = item.nature?.dre_section ?? null;
      if (!map.has(key)) {
        map.set(key, {
          nature_id: item.nature?.id ?? null,
          nature_name: name,
          dre_section: sec,
          realized: 0n, projected: 0n, total: 0n,
        });
      }
      const g = map.get(key)!;
      g.realized += item.amount;
      g.total = g.realized + g.projected;
    }
    return Array.from(map.values());
  }

  /** Combina dois arrays agrupados por natureza, somando realized + projected. */
  private mergeByNature(a: CashFlowGroup[], b: CashFlowGroup[]): CashFlowGroup[] {
    const map = new Map<string, CashFlowGroup>();
    const upsert = (g: CashFlowGroup) => {
      const key = g.nature_id ?? `_${g.nature_name}`;
      if (!map.has(key)) {
        map.set(key, { ...g });
      } else {
        const existing = map.get(key)!;
        existing.realized += g.realized;
        existing.projected += g.projected;
        existing.total = existing.realized + existing.projected;
      }
    };
    a.forEach(upsert);
    b.forEach(upsert);
    return Array.from(map.values());
  }
}
