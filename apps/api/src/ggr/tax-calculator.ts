/**
 * Calculadora de impostos para casas de apostas brasileiras.
 *
 * Base legal:
 * - Lei 14.790/2023: 12% sobre receita líquida (GGR)
 * - Lei 14.790 art. 31: IRRF 15% sobre prêmios líquidos > faixa de isenção
 * - PIS/COFINS regime cumulativo: 0,65% + 3,00% sobre receita bruta
 *
 * IMPORTANTE: estes cálculos refletem o entendimento normativo atual (2026).
 * O escritório contábil deve sempre validar conforme jurisprudência e
 * normativos da SPA/Receita Federal vigentes.
 */

export interface TaxCalculation {
  // Base
  total_bets: bigint;
  total_prizes: bigint;
  ggr: bigint;
  net_revenue: bigint;

  // Lei 14.790 - 12% sobre receita líquida
  tax_lei14790_rate: number;
  tax_lei14790_amount: bigint;

  // IRRF 15% sobre prêmios > faixa
  irrf_threshold_cents: bigint;
  irrf_rate: number;
  irrf_taxable_base: bigint;
  irrf_amount: bigint;

  // PIS sobre receita bruta
  pis_rate: number;
  pis_amount: bigint;

  // COFINS sobre receita bruta
  cofins_rate: number;
  cofins_amount: bigint;

  total_taxes: bigint;
}

export interface TaxConfig {
  tax_lei14790_rate?: number; // default 12.0
  irrf_threshold_cents?: bigint; // default 282400 (R$ 2.824,00 - faixa de isenção do IRPF mensal 2026)
  irrf_rate?: number; // default 15.0
  pis_rate?: number; // default 0.65
  cofins_rate?: number; // default 3.0
  /**
   * Quando true, calcula IRRF sobre o total de prêmios pagos com base em uma
   * estimativa proporcional (assumindo que X% dos prêmios excederam a faixa).
   *
   * Valor padrão: 0.85 (85% dos prêmios estão tributáveis no agregado mensal).
   * Esta é uma simplificação contábil — para apuração precisa, seria necessário
   * processar prêmio por prêmio individualmente. Configurável por marca.
   */
  irrf_taxable_estimate_ratio?: number;
}

const DEFAULT_CONFIG: Required<TaxConfig> = {
  tax_lei14790_rate: 12.0,
  irrf_threshold_cents: BigInt(282400), // R$ 2.824,00
  irrf_rate: 15.0,
  pis_rate: 0.65,
  cofins_rate: 3.0,
  irrf_taxable_estimate_ratio: 0.85,
};

function applyRate(amount: bigint, ratePercent: number): bigint {
  // Multiplica em bigint mantendo precisão de 4 casas (rate × 10000)
  const factor = BigInt(Math.round(ratePercent * 10000));
  return (amount * factor) / BigInt(1_000_000);
}

export function calculateTaxes(
  total_bets: bigint,
  total_prizes: bigint,
  config?: TaxConfig,
): TaxCalculation {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // GGR = apostas - prêmios
  const ggr = total_bets - total_prizes;
  const net_revenue = ggr; // No caso BR, líquido já é o próprio GGR no agregado mensal
  
  // Lei 14.790: 12% sobre receita líquida (não pode ser negativo)
  const baseLei14790 = ggr > 0n ? ggr : 0n;
  const tax_lei14790_amount = applyRate(baseLei14790, cfg.tax_lei14790_rate);

  // IRRF 15% sobre prêmios > faixa
  // Estimativa proporcional: assume que X% dos prêmios pagos foram acima da faixa
  // (numa apuração precisa, seria prêmio a prêmio)
  const estimated_taxable = applyRate(total_prizes, cfg.irrf_taxable_estimate_ratio * 100);
  const irrf_taxable_base = estimated_taxable;
  const irrf_amount = applyRate(irrf_taxable_base, cfg.irrf_rate);

  // PIS sobre receita bruta (apostas totais — interpretação conservadora)
  // ATENÇÃO: a base de cálculo do PIS/COFINS para casas de apostas ainda é
  // tema de discussão jurídica. Aqui usamos GGR como base (entendimento mais
  // moderno/favorável ao contribuinte).
  const baseSocial = baseLei14790;
  const pis_amount = applyRate(baseSocial, cfg.pis_rate);
  const cofins_amount = applyRate(baseSocial, cfg.cofins_rate);

  const total_taxes = tax_lei14790_amount + irrf_amount + pis_amount + cofins_amount;

  return {
    total_bets,
    total_prizes,
    ggr,
    net_revenue,
    tax_lei14790_rate: cfg.tax_lei14790_rate,
    tax_lei14790_amount,
    irrf_threshold_cents: cfg.irrf_threshold_cents,
    irrf_rate: cfg.irrf_rate,
    irrf_taxable_base,
    irrf_amount,
    pis_rate: cfg.pis_rate,
    pis_amount,
    cofins_rate: cfg.cofins_rate,
    cofins_amount,
    total_taxes,
  };
}

/**
 * Calcula a divergência de segregação patrimonial.
 *
 * O saldo "esperado" da conta de jogadores deve ser:
 *   saldo_jogadores = depósitos_acumulados - saques_acumulados - apostas_acumuladas + prêmios_acumulados
 *
 * Esse valor deve ser SEPARADO/SEGREGADO em conta bancária específica da operadora
 * (segregação patrimonial obrigatória pela Lei 14.790 e BCB).
 *
 * Se o saldo bancário "real" (somando contas bancárias da operadora) for MENOR que
 * o saldo esperado de jogadores, é um SINAL DE ALERTA — indica que a operadora
 * pode estar usando dinheiro dos jogadores indevidamente.
 */
export function calculatePlayersBalance(
  total_deposits: bigint,
  total_withdrawals: bigint,
  total_bets: bigint,
  total_prizes: bigint,
): bigint {
  // Saldo dos jogadores acumulado:
  //   + depósitos (entrou na carteira)
  //   - saques (saiu da carteira)
  //   - apostas (jogador comprometeu na aposta)
  //   + prêmios (jogador recebeu prêmio na carteira)
  return total_deposits - total_withdrawals - total_bets + total_prizes;
}

export interface SegregationCheck {
  expected_players_balance: bigint;
  actual_bank_balance: bigint;
  divergence: bigint; // positiva = sobra (ok), negativa = falta (alerta)
  is_healthy: boolean;
  alert_level: 'OK' | 'WARNING' | 'CRITICAL';
}

/**
 * Verifica saúde da segregação patrimonial.
 * Tolerância de 1% para flutuações operacionais normais.
 */
export function checkSegregation(
  expected_players_balance: bigint,
  actual_bank_balance: bigint,
): SegregationCheck {
  const divergence = actual_bank_balance - expected_players_balance;

  // Tolerância: 1% do saldo esperado (mínimo de R$ 100)
  const tolerance_cents = expected_players_balance > 0n
    ? (expected_players_balance * BigInt(1)) / BigInt(100)
    : BigInt(10000);
  const min_tolerance = BigInt(10000);
  const effective_tolerance = tolerance_cents > min_tolerance ? tolerance_cents : min_tolerance;

  let alert_level: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
  if (divergence < 0n) {
    // Falta dinheiro
    const absDiv = -divergence;
    if (absDiv > effective_tolerance * BigInt(5)) {
      alert_level = 'CRITICAL';
    } else if (absDiv > effective_tolerance) {
      alert_level = 'WARNING';
    }
  }

  return {
    expected_players_balance,
    actual_bank_balance,
    divergence,
    is_healthy: alert_level === 'OK',
    alert_level,
  };
}
