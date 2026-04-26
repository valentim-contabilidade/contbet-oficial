import { Injectable, BadRequestException } from '@nestjs/common';
import { Profile, PaymentStatus, IrpjApurationStatus, GgrApurationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeBigInt } from '../financial/money.helper';
import { resolvePeriod, percentageChange, percentage, PeriodType, toNumber } from './period.helper';

export interface DreInput {
  company_id: string;
  brand_id?: string;
  period_type: PeriodType;
  year: number;
  month?: number;
  quarter?: number;
  start_date?: string;
  end_date?: string;
}

interface DreLine {
  label: string;
  amount: bigint;
  amount_previous: bigint;
  variation_percent: number | null;
  is_negative?: boolean;       // se a linha é redutiva (deduções, despesas)
  is_total?: boolean;          // se é totalizador (Receita Líquida, Lucro Bruto, etc.)
  level?: number;              // 0=raiz/total, 1=grupo, 2=subitem (para indentação visual)
}

interface ExpenseByCategory {
  category_id: string | null;
  category_name: string;
  category_color: string | null;
  dre_section: string | null;
  amount: bigint;
  amount_previous: bigint;
  percent_of_total: number | null;
  variation_percent: number | null;
}

@Injectable()
export class DreService {
  constructor(private prisma: PrismaService) {}

  /**
   * Monta a DRE clássica completa para o período solicitado.
   * Cruza dados de:
   *   - GGR consolidado (receita bruta e prêmios)
   *   - Contas a Receber recebidas (outras receitas)
   *   - Contas a Pagar pagas (despesas operacionais)
   *   - Apurações GGR fechadas (impostos sobre receita: Lei 14.790, PIS, COFINS)
   *   - Apurações IRPJ/CSLL fechadas
   */
  async generateDre(input: DreInput, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== input.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
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

    // Base where para cruzar tudo
    const baseWhere: any = {
      company_id: input.company_id,
      metadeleted: false,
    };
    if (input.brand_id) baseWhere.brand_id = input.brand_id;

    // === Coleta dados em paralelo (atual + período anterior) ===
    const [data, previous] = await Promise.all([
      this.collectPeriodData(baseWhere, period.start, period.end),
      this.collectPeriodData(baseWhere, period.previous_start, period.previous_end),
    ]);

    // === Monta as linhas da DRE ===
    const lines: DreLine[] = [];

    // === RECEITA OPERACIONAL BRUTA ===
    lines.push({
      label: 'RECEITA OPERACIONAL BRUTA',
      amount: data.ggr_total + data.other_revenue,
      amount_previous: previous.ggr_total + previous.other_revenue,
      variation_percent: percentageChange(data.ggr_total + data.other_revenue, previous.ggr_total + previous.other_revenue),
      is_total: true,
      level: 0,
    });
    lines.push({
      label: 'GGR (Receita de Apostas)',
      amount: data.ggr_total,
      amount_previous: previous.ggr_total,
      variation_percent: percentageChange(data.ggr_total, previous.ggr_total),
      level: 1,
    });
    if (data.other_revenue > 0n || previous.other_revenue > 0n) {
      lines.push({
        label: 'Outras Receitas Operacionais',
        amount: data.other_revenue,
        amount_previous: previous.other_revenue,
        variation_percent: percentageChange(data.other_revenue, previous.other_revenue),
        level: 1,
      });
    }

    // === DEDUÇÕES DA RECEITA ===
    const total_deductions = data.tax_lei14790 + data.pis_revenue + data.cofins_revenue + data.iss;
    const total_deductions_prev = previous.tax_lei14790 + previous.pis_revenue + previous.cofins_revenue + previous.iss;
    lines.push({
      label: '(-) DEDUÇÕES DA RECEITA',
      amount: total_deductions,
      amount_previous: total_deductions_prev,
      variation_percent: percentageChange(total_deductions, total_deductions_prev),
      is_negative: true,
      is_total: true,
      level: 0,
    });
    if (data.tax_lei14790 > 0n || previous.tax_lei14790 > 0n) {
      lines.push({
        label: 'Imposto Lei 14.790 (12%)',
        amount: data.tax_lei14790,
        amount_previous: previous.tax_lei14790,
        variation_percent: percentageChange(data.tax_lei14790, previous.tax_lei14790),
        is_negative: true,
        level: 1,
      });
    }
    if (data.pis_revenue > 0n || previous.pis_revenue > 0n) {
      lines.push({
        label: 'PIS sobre Receita',
        amount: data.pis_revenue,
        amount_previous: previous.pis_revenue,
        variation_percent: percentageChange(data.pis_revenue, previous.pis_revenue),
        is_negative: true,
        level: 1,
      });
    }
    if (data.cofins_revenue > 0n || previous.cofins_revenue > 0n) {
      lines.push({
        label: 'COFINS sobre Receita',
        amount: data.cofins_revenue,
        amount_previous: previous.cofins_revenue,
        variation_percent: percentageChange(data.cofins_revenue, previous.cofins_revenue),
        is_negative: true,
        level: 1,
      });
    }

    // === RECEITA LÍQUIDA ===
    const receita_bruta = data.ggr_total + data.other_revenue;
    const receita_bruta_prev = previous.ggr_total + previous.other_revenue;
    const receita_liquida = receita_bruta - total_deductions;
    const receita_liquida_prev = receita_bruta_prev - total_deductions_prev;
    lines.push({
      label: '(=) RECEITA LÍQUIDA',
      amount: receita_liquida,
      amount_previous: receita_liquida_prev,
      variation_percent: percentageChange(receita_liquida, receita_liquida_prev),
      is_total: true,
      level: 0,
    });

    // === CUSTOS OPERACIONAIS (prêmios pagos do GGR são custo do "negócio") ===
    lines.push({
      label: '(-) CUSTOS OPERACIONAIS',
      amount: data.prizes_paid,
      amount_previous: previous.prizes_paid,
      variation_percent: percentageChange(data.prizes_paid, previous.prizes_paid),
      is_negative: true,
      is_total: true,
      level: 0,
    });
    lines.push({
      label: 'Prêmios Pagos a Apostadores',
      amount: data.prizes_paid,
      amount_previous: previous.prizes_paid,
      variation_percent: percentageChange(data.prizes_paid, previous.prizes_paid),
      is_negative: true,
      level: 1,
    });

    // === LUCRO BRUTO ===
    const lucro_bruto = receita_liquida - data.prizes_paid;
    const lucro_bruto_prev = receita_liquida_prev - previous.prizes_paid;
    lines.push({
      label: '(=) LUCRO BRUTO',
      amount: lucro_bruto,
      amount_previous: lucro_bruto_prev,
      variation_percent: percentageChange(lucro_bruto, lucro_bruto_prev),
      is_total: true,
      level: 0,
    });

    // === DESPESAS OPERACIONAIS (agrupadas por categoria) ===
    const total_expenses = data.total_expenses;
    const total_expenses_prev = previous.total_expenses;
    lines.push({
      label: '(-) DESPESAS OPERACIONAIS',
      amount: total_expenses,
      amount_previous: total_expenses_prev,
      variation_percent: percentageChange(total_expenses, total_expenses_prev),
      is_negative: true,
      is_total: true,
      level: 0,
    });
    for (const cat of data.expenses_by_category) {
      lines.push({
        label: cat.category_name,
        amount: cat.amount,
        amount_previous: cat.amount_previous,
        variation_percent: cat.variation_percent,
        is_negative: true,
        level: 1,
      });
    }

    // === RESULTADO ANTES DO IRPJ/CSLL (EBT) ===
    const ebt = lucro_bruto - total_expenses;
    const ebt_prev = lucro_bruto_prev - total_expenses_prev;
    lines.push({
      label: '(=) RESULTADO ANTES DO IRPJ/CSLL',
      amount: ebt,
      amount_previous: ebt_prev,
      variation_percent: percentageChange(ebt, ebt_prev),
      is_total: true,
      level: 0,
    });

    // === IRPJ + CSLL (das apurações fechadas no período) ===
    const total_irpj_csll = data.irpj_csll;
    const total_irpj_csll_prev = previous.irpj_csll;
    if (total_irpj_csll > 0n || total_irpj_csll_prev > 0n) {
      lines.push({
        label: '(-) IRPJ + CSLL',
        amount: total_irpj_csll,
        amount_previous: total_irpj_csll_prev,
        variation_percent: percentageChange(total_irpj_csll, total_irpj_csll_prev),
        is_negative: true,
        is_total: true,
        level: 0,
      });
    }

    // === LUCRO LÍQUIDO ===
    const lucro_liquido = ebt - total_irpj_csll;
    const lucro_liquido_prev = ebt_prev - total_irpj_csll_prev;
    lines.push({
      label: '(=) LUCRO LÍQUIDO DO PERÍODO',
      amount: lucro_liquido,
      amount_previous: lucro_liquido_prev,
      variation_percent: percentageChange(lucro_liquido, lucro_liquido_prev),
      is_total: true,
      level: 0,
    });

    // === Indicadores ===
    const indicators = {
      receita_bruta: receita_bruta.toString(),
      receita_liquida: receita_liquida.toString(),
      lucro_bruto: lucro_bruto.toString(),
      ebt: ebt.toString(),
      lucro_liquido: lucro_liquido.toString(),
      // EBITDA = EBT (não temos depreciação separada ainda)
      ebitda: ebt.toString(),

      margem_bruta: percentage(lucro_bruto, receita_liquida),
      margem_operacional: percentage(ebt, receita_liquida),
      margem_liquida: percentage(lucro_liquido, receita_liquida),
      payout_ratio: percentage(data.prizes_paid, data.ggr_total + data.prizes_paid),

      lucro_liquido_anterior: lucro_liquido_prev.toString(),
      variacao_lucro: percentageChange(lucro_liquido, lucro_liquido_prev),
      variacao_receita: percentageChange(receita_bruta, receita_bruta_prev),
    };

    // Série mensal dos últimos 12 meses para gráfico de evolução
    const monthly_series = await this.buildMonthlySeries(input.company_id, input.brand_id, period.end);

    return serializeBigInt({
      period: {
        type: input.period_type,
        label: period.label,
        previous_label: period.previous_label,
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      lines,
      expenses_by_category: data.expenses_by_category,
      indicators,
      monthly_series,
    });
  }

  /** Coleta todos os dados financeiros do período */
  private async collectPeriodData(baseWhere: any, start: Date, end: Date) {
    // === GGR Total e Prêmios (de todos os GgrDailyRecord do período) ===
    const ggrRecords = await this.prisma.ggrDailyRecord.findMany({
      where: {
        ...baseWhere,
        date: { gte: start, lt: end },
      },
      select: { ggr: true, total_prizes: true },
    });
    const ggr_total = ggrRecords.reduce((s, r) => s + r.ggr, 0n);
    const prizes_paid = ggrRecords.reduce((s, r) => s + r.total_prizes, 0n);

    // === Outras receitas (Contas a Receber - regime de competência, por emissão) ===
    const receivables = await this.prisma.accountReceivable.findMany({
      where: {
        ...baseWhere,
        status: { not: PaymentStatus.CANCELLED },
        issue_date: { gte: start, lt: end },
      },
      select: { amount: true },
    });
    const other_revenue = receivables.reduce((s, r) => s + r.amount, 0n);

    // === Impostos sobre receita (apurações GGR fechadas/pagas) ===
    // Pega apurações cujo período coincide com o período da DRE
    const ggrApurations = await this.findGgrApurationsInPeriod(baseWhere.company_id, baseWhere.brand_id, start, end);
    const tax_lei14790 = ggrApurations.reduce((s, a) => s + a.tax_lei14790_amount, 0n);
    const pis_revenue = ggrApurations.reduce((s, a) => s + a.pis_amount_payable, 0n);
    const cofins_revenue = ggrApurations.reduce((s, a) => s + a.cofins_amount_payable, 0n);
    const iss = 0n; // ISS só viria de NFSe emitidas (módulo fiscal); por enquanto 0

    // === Despesas (Contas a Pagar - regime de competência, por emissão) ===
    // Agrupadas por Natureza Contábil (DRE); fallback para categoria visual / "Sem natureza".
    const payables = await this.prisma.accountPayable.findMany({
      where: {
        ...baseWhere,
        status: { not: PaymentStatus.CANCELLED },
        duplicate_of_id: null,
        issue_date: { gte: start, lt: end },
      },
      select: {
        amount: true,
        nature: { select: { id: true, name: true, dre_section: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    });
    const total_expenses = payables.reduce((s, p) => s + p.amount, 0n);
    const expenses_by_category = this.groupExpensesByCategory(payables);

    // === IRPJ/CSLL (apurações trimestrais fechadas no período) ===
    const irpjApurations = await this.prisma.irpjCsllApuration.findMany({
      where: {
        company_id: baseWhere.company_id,
        metadeleted: false,
        OR: [
          { closed_at: { gte: start, lt: end } },
          { paid_at: { gte: start, lt: end } },
        ],
        status: { in: [IrpjApurationStatus.CLOSED, IrpjApurationStatus.PAID] },
      },
      select: { total_taxes: true },
    });
    const irpj_csll = irpjApurations.reduce((s, a) => s + a.total_taxes, 0n);

    return {
      ggr_total,
      prizes_paid,
      other_revenue,
      tax_lei14790,
      pis_revenue,
      cofins_revenue,
      iss,
      total_expenses,
      expenses_by_category,
      irpj_csll,
    };
  }

  /** Busca apurações GGR cujo período se sobrepõe ao período da DRE */
  private async findGgrApurationsInPeriod(companyId: string, brandId: string | undefined, start: Date, end: Date) {
    // Determina range de meses cobertos pelo período
    const startYear = start.getUTCFullYear();
    const startMonth = start.getUTCMonth() + 1;
    const endDate = new Date(end.getTime() - 1); // último ms do dia anterior
    const endYear = endDate.getUTCFullYear();
    const endMonth = endDate.getUTCMonth() + 1;

    const where: any = {
      company_id: companyId,
      metadeleted: false,
      status: { in: [GgrApurationStatus.CLOSED, GgrApurationStatus.PAID] },
    };
    if (brandId) where.brand_id = brandId;

    // Lista todos (ano, mês) cobertos
    const yearMonths: { year: number; month: number }[] = [];
    let y = startYear, m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      yearMonths.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    if (yearMonths.length === 0) return [];

    where.OR = yearMonths.map(ym => ({ year: ym.year, month: ym.month }));

    return this.prisma.ggrMonthlyApuration.findMany({
      where,
      select: {
        tax_lei14790_amount: true,
        pis_amount_payable: true,
        cofins_amount_payable: true,
      },
    });
  }

  /** Agrupa despesas por Natureza Contábil (DRE) com fallback para categoria visual. */
  private groupExpensesByCategory(
    payables: Array<{
      amount: bigint;
      nature: { id: string; name: string; dre_section: string } | null;
      category: { id: string; name: string; color: string | null } | null;
    }>,
  ): ExpenseByCategory[] {
    const map = new Map<string, ExpenseByCategory>();

    for (const p of payables) {
      const key = p.nature?.id ?? p.category?.id ?? 'sem-natureza';
      const name = p.nature?.name ?? p.category?.name ?? 'Sem natureza';
      const color = p.category?.color ?? null;
      const section = p.nature?.dre_section ?? null;

      if (!map.has(key)) {
        map.set(key, {
          category_id: p.nature?.id ?? p.category?.id ?? null,
          category_name: name,
          category_color: color,
          dre_section: section,
          amount: 0n,
          amount_previous: 0n,
          percent_of_total: null,
          variation_percent: null,
        });
      }
      const item = map.get(key)!;
      item.amount += p.amount;
    }

    const total = Array.from(map.values()).reduce((s, c) => s + c.amount, 0n);

    return Array.from(map.values())
      .map(c => ({ ...c, percent_of_total: percentage(c.amount, total) }))
      .sort((a, b) => Number(b.amount - a.amount));
  }

  /** Constrói série mensal dos últimos 12 meses para gráfico de evolução */
  private async buildMonthlySeries(companyId: string, brandId: string | undefined, endDate: Date) {
    const series: any[] = [];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const baseEndYear = endDate.getUTCFullYear();
    const baseEndMonth = endDate.getUTCMonth(); // 0-based

    for (let i = 11; i >= 0; i--) {
      const yOffset = Math.floor((baseEndMonth - i) / 12);
      const month = ((baseEndMonth - i) % 12 + 12) % 12;
      const year = baseEndYear + yOffset;
      const monthStart = new Date(Date.UTC(year, month, 1));
      const monthEnd = new Date(Date.UTC(year, month + 1, 1));

      const baseWhere: any = { company_id: companyId, metadeleted: false };
      if (brandId) baseWhere.brand_id = brandId;

      // Receita = GGR + recebíveis (regime de competência, por emissão)
      const [ggrSum, recvSum, paySum] = await Promise.all([
        this.prisma.ggrDailyRecord.aggregate({
          where: { ...baseWhere, date: { gte: monthStart, lt: monthEnd } },
          _sum: { ggr: true, total_prizes: true },
        }),
        this.prisma.accountReceivable.aggregate({
          where: { ...baseWhere, status: { not: PaymentStatus.CANCELLED }, issue_date: { gte: monthStart, lt: monthEnd } },
          _sum: { amount: true },
        }),
        this.prisma.accountPayable.aggregate({
          where: { ...baseWhere, status: { not: PaymentStatus.CANCELLED }, duplicate_of_id: null, issue_date: { gte: monthStart, lt: monthEnd } },
          _sum: { amount: true },
        }),
      ]);

      const ggr = ggrSum._sum.ggr ?? 0n;
      const prizes = ggrSum._sum.total_prizes ?? 0n;
      const recv = recvSum._sum.amount ?? 0n;
      const pay = paySum._sum.amount ?? 0n;

      const revenue = ggr + recv;
      // Lucro simplificado: Receita - Custos (prêmios) - Despesas
      const profit = revenue - prizes - pay;

      series.push({
        year,
        month: month + 1,
        label: `${monthNames[month]}/${String(year).slice(2)}`,
        revenue: revenue.toString(),
        prizes: prizes.toString(),
        expenses: pay.toString(),
        profit: profit.toString(),
      });
    }

    return series;
  }
}
