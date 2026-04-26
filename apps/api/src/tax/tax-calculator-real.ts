/**
 * Calculadora tributária para empresas em Lucro Real.
 *
 * Inclui:
 * - PIS/COFINS não-cumulativo (1,65% + 7,60%) com créditos sobre despesas
 * - IRPJ trimestral (15% + adicional de 10% sobre o que exceder R$ 60.000/trim)
 * - CSLL trimestral (9%)
 *
 * IMPORTANTE: estes cálculos refletem o entendimento normativo atual (2026).
 * O escritório contábil deve sempre validar conforme jurisprudência e
 * normativos da Receita Federal vigentes.
 */

export interface PisCofinsNaoCumulativoInput {
  total_revenue: bigint;       // receita do período (em centavos)
  expenses_with_credit: bigint; // despesas que geram crédito (centavos)
  pis_rate: number;             // padrão 1.65 não-cumulativo
  cofins_rate: number;          // padrão 7.60 não-cumulativo
}

export interface PisCofinsNaoCumulativoResult {
  pis_amount: bigint;           // débito de PIS (sobre receita)
  pis_credits: bigint;          // crédito de PIS (sobre despesas)
  pis_amount_payable: bigint;   // valor líquido a pagar (débito - crédito)

  cofins_amount: bigint;
  cofins_credits: bigint;
  cofins_amount_payable: bigint;

  total_payable: bigint;        // soma PIS + COFINS líquidos
}

function applyRate(amount: bigint, ratePercent: number): bigint {
  if (amount <= 0n) return 0n;
  const factor = BigInt(Math.round(ratePercent * 10000));
  return (amount * factor) / BigInt(1_000_000);
}

/**
 * Calcula PIS/COFINS no regime não-cumulativo.
 *
 * Mecânica:
 * - Sobre a receita aplica-se 1,65% PIS + 7,60% COFINS (débitos)
 * - Sobre despesas elegíveis aplica-se a mesma alíquota (créditos)
 * - O valor a pagar é (débito - crédito), nunca menor que zero
 */
export function calculatePisCofinsNaoCumulativo(
  input: PisCofinsNaoCumulativoInput,
): PisCofinsNaoCumulativoResult {
  const pis_amount = applyRate(input.total_revenue, input.pis_rate);
  const pis_credits = applyRate(input.expenses_with_credit, input.pis_rate);
  const pis_amount_payable = pis_amount > pis_credits ? pis_amount - pis_credits : 0n;

  const cofins_amount = applyRate(input.total_revenue, input.cofins_rate);
  const cofins_credits = applyRate(input.expenses_with_credit, input.cofins_rate);
  const cofins_amount_payable = cofins_amount > cofins_credits ? cofins_amount - cofins_credits : 0n;

  return {
    pis_amount,
    pis_credits,
    pis_amount_payable,
    cofins_amount,
    cofins_credits,
    cofins_amount_payable,
    total_payable: pis_amount_payable + cofins_amount_payable,
  };
}

// =================== IRPJ + CSLL ===================

export interface IrpjCsllInput {
  total_revenue: bigint;        // receita total do período
  deductible_expenses: bigint;  // despesas dedutíveis pagas no período
  total_additions: bigint;      // adições LALUR (aumentam lucro real)
  total_exclusions: bigint;     // exclusões LALUR (reduzem lucro real)

  // Configurações
  irpj_rate: number;                       // padrão 15.0
  irpj_additional_rate: number;            // padrão 10.0
  irpj_additional_threshold_cents: bigint; // R$ 60.000 para trimestre, R$ 20.000 para mês
  csll_rate: number;                       // padrão 9.0
}

export interface IrpjCsllResult {
  // Lucro contábil
  accounting_profit: bigint;

  // Lucro real (após ajustes do LALUR)
  taxable_profit: bigint;

  // IRPJ
  irpj_base_amount: bigint;          // 15% sobre lucro real
  irpj_additional_amount: bigint;    // 10% sobre lucro que excede limite
  irpj_total: bigint;

  // CSLL
  csll_amount: bigint;

  total_taxes: bigint;
}

/**
 * Calcula IRPJ + CSLL no regime de Lucro Real.
 *
 * Fórmula:
 * 1. Lucro contábil = Receita - Despesas dedutíveis
 * 2. Lucro real = Lucro contábil + Adições - Exclusões
 * 3. IRPJ base = 15% × Lucro real (se positivo)
 * 4. IRPJ adicional = 10% × (Lucro real - R$ 60.000) (se exceder limite)
 * 5. CSLL = 9% × Lucro real
 *
 * Se lucro real for negativo (prejuízo), não há tributo a pagar.
 * O prejuízo pode ser compensado em períodos futuros (até 30% do lucro).
 */
export function calculateIrpjCsll(input: IrpjCsllInput): IrpjCsllResult {
  const accounting_profit = input.total_revenue - input.deductible_expenses;
  const taxable_profit =
    accounting_profit + input.total_additions - input.total_exclusions;

  // Se prejuízo, não há tributo
  if (taxable_profit <= 0n) {
    return {
      accounting_profit,
      taxable_profit,
      irpj_base_amount: 0n,
      irpj_additional_amount: 0n,
      irpj_total: 0n,
      csll_amount: 0n,
      total_taxes: 0n,
    };
  }

  // IRPJ base: 15% sobre TODO o lucro real
  const irpj_base_amount = applyRate(taxable_profit, input.irpj_rate);

  // IRPJ adicional: 10% sobre o que EXCEDE o limite
  let irpj_additional_amount = 0n;
  if (taxable_profit > input.irpj_additional_threshold_cents) {
    const excess = taxable_profit - input.irpj_additional_threshold_cents;
    irpj_additional_amount = applyRate(excess, input.irpj_additional_rate);
  }

  const irpj_total = irpj_base_amount + irpj_additional_amount;

  // CSLL: 9% sobre lucro real
  const csll_amount = applyRate(taxable_profit, input.csll_rate);

  const total_taxes = irpj_total + csll_amount;

  return {
    accounting_profit,
    taxable_profit,
    irpj_base_amount,
    irpj_additional_amount,
    irpj_total,
    csll_amount,
    total_taxes,
  };
}

// =================== IRPJ + CSLL — LUCRO PRESUMIDO ===================

export interface IrpjCsllPresumidoInput {
  total_revenue: bigint;
  presumed_irpj_rate: number;     // % de presunção sobre receita (ex: 32 para serviços)
  presumed_csll_rate: number;     // % de presunção (ex: 32)
  irpj_rate: number;              // 15
  irpj_additional_rate: number;   // 10
  irpj_additional_threshold_cents: bigint; // 60.000 trim / 20.000 mês
  csll_rate: number;              // 9
}

export interface IrpjCsllPresumidoResult {
  presumed_irpj_base: bigint;     // receita × presunção_irpj
  presumed_csll_base: bigint;     // receita × presunção_csll
  irpj_base_amount: bigint;
  irpj_additional_amount: bigint;
  irpj_total: bigint;
  csll_amount: bigint;
  total_taxes: bigint;
}

/**
 * Lucro Presumido: IRPJ e CSLL incidem sobre uma base presumida = receita × percentual de presunção.
 * Não há LALUR e não se desconta despesa (o "lucro" é estimado pela legislação).
 */
export function calculateIrpjCsllPresumido(input: IrpjCsllPresumidoInput): IrpjCsllPresumidoResult {
  const presumed_irpj_base = applyRate(input.total_revenue, input.presumed_irpj_rate);
  const presumed_csll_base = applyRate(input.total_revenue, input.presumed_csll_rate);

  const irpj_base_amount = applyRate(presumed_irpj_base, input.irpj_rate);

  let irpj_additional_amount = 0n;
  if (presumed_irpj_base > input.irpj_additional_threshold_cents) {
    const excess = presumed_irpj_base - input.irpj_additional_threshold_cents;
    irpj_additional_amount = applyRate(excess, input.irpj_additional_rate);
  }

  const irpj_total = irpj_base_amount + irpj_additional_amount;
  const csll_amount = applyRate(presumed_csll_base, input.csll_rate);

  return {
    presumed_irpj_base,
    presumed_csll_base,
    irpj_base_amount,
    irpj_additional_amount,
    irpj_total,
    csll_amount,
    total_taxes: irpj_total + csll_amount,
  };
}

// =================== ISS ===================

export interface IssInput {
  base_amount: bigint; // base já calculada (GGR ou NGR), em centavos
  iss_rate: number;    // alíquota municipal (2 a 5 tipicamente)
}

export interface IssResult {
  iss_amount: bigint;
}

/**
 * Calcula ISS sobre a base escolhida (GGR ou NGR).
 * A base é fornecida pelo chamador conforme legislação municipal aplicável.
 */
export function calculateIss(input: IssInput): IssResult {
  return { iss_amount: applyRate(input.base_amount, input.iss_rate) };
}

/**
 * Helper: dados das datas para uma apuração trimestral
 * Q1 = Jan/Fev/Mar
 * Q2 = Abr/Mai/Jun
 * Q3 = Jul/Ago/Set
 * Q4 = Out/Nov/Dez
 */
export function getQuarterDateRange(year: number, quarter: number): { start: Date; end: Date } {
  if (quarter < 1 || quarter > 4) throw new Error('Trimestre deve ser de 1 a 4');
  const startMonth = (quarter - 1) * 3; // 0-based
  const endMonth = startMonth + 3;
  return {
    start: new Date(Date.UTC(year, startMonth, 1)),
    end: new Date(Date.UTC(year, endMonth, 1)),
  };
}

/**
 * Helper: limite mensal do adicional de IRPJ.
 * Trimestre = R$ 60.000 (6.000.000 centavos)
 * Mês       = R$ 20.000 (2.000.000 centavos)
 */
export function getAdditionalThreshold(periodType: 'TRIMESTRAL' | 'ANUAL_ESTIMATIVA'): bigint {
  return periodType === 'TRIMESTRAL' ? 6000000n : 2000000n;
}
