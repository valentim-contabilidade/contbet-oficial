/**
 * Catálogo completo das destinações devidas pelos agentes operadores de
 * apostas de quota fixa, conforme:
 *
 *   - Lei nº 13.756/2018, art. 30, §1º-A (com alterações da Lei 14.790/2023,
 *     da Lei Complementar nº 224/2025 e da Medida Provisória nº 1.348/2026)
 *   - Manual SPA/MF "Operacionalização, Cálculo e Pagamento dos Repasses
 *     Diretos" (versão 08/05/2026)
 *   - Portaria SPA/MF nº 1.287/2026 (códigos DARF para Conta Única do Tesouro)
 *   - Portaria SPA/MF nº 41/2025 (destinação por imagem)
 *   - Portaria MEC nº 1.240/2024 e nº 772/2025 (destinações de educação)
 *   - Instrução Normativa SPA/MF nº 9/2025
 *
 * BASE DE CÁLCULO ("BC" / GGR):
 *   GGR = arrecadação total das apostas − prêmios pagos − IR sobre premiação
 *   (= "produto da arrecadação após a dedução dos incisos III e V do
 *    caput do art. 30")
 *
 * MODELO DE DUAS CAMADAS:
 *
 *   1. Destinações Totais (D = 12% do GGR) — distribuídas em 4 categorias
 *      conforme o §1º-A. Cada beneficiário tem um "Percentual P" relativo
 *      a esses 12%. A taxa real sobre o GGR é (D × P).
 *
 *   2. FUNAPOL caput (escalonado) — fora dos 12%, aplicado direto sobre o GGR:
 *        · 1% a partir de abril/2026
 *        · 2% a partir de janeiro/2027
 *        · 3% a partir de janeiro/2028
 *
 *   Total recolhido em 2026 = 12% (destinações) + 1% (FUNAPOL caput) = 13% do GGR.
 *
 * IMPORTANTE: a coluna "Percentual na Lei" da Portaria 1.287/2026 corresponde
 * ao Percentual P do manual (% das destinações totais), NÃO ao % do GGR.
 * O cálculo correto multiplica P × 12% para obter a alíquota efetiva.
 */

export type DestinationCategory =
  /** DARF — recolhimento à Conta Única do Tesouro Nacional */
  | 'CONTA_UNICA_TESOURO'
  /** Transferência bancária a entidade privada designada nominalmente pela Lei */
  | 'ENTIDADE_PRIVADA'
  /** Destinação de educação — paga conforme Portaria MEC 1.240/2024 */
  | 'EDUCACAO'
  /** Destinação por uso de direitos de imagem e propriedade intelectual,
   *  rateada por competição esportiva conforme Portaria SPA/MF 41/2025 */
  | 'IMAGEM_PROP_INTELECTUAL';

export type DarfCode = '9197' | '6524' | '5862';

export interface DestinationDef {
  /** Identificador estável (snake_case, sem acento). */
  slug: string;
  /** Nome do beneficiário ou da rubrica. */
  name: string;
  /** Dispositivo legal específico (ex.: "Art. 30, §1º-A, IV-A"). */
  dispositivo: string;
  category: DestinationCategory;
  /** Percentual P — fração das Destinações Totais (12%) atribuída a este beneficiário.
   *  A alíquota efetiva sobre o GGR é P × 12%. */
  percent_of_destinations: number;
  /** Código DARF (apenas se category === 'CONTA_UNICA_TESOURO'). */
  darf_code?: DarfCode;
  /** Descrição do recolhimento (DARF nº X, dados bancários restritos, etc.). */
  payment_method: string;
  /** True se é destinação repartida por competição esportiva (não há valor
   *  consolidado mensal — só valor agregado). */
  per_competition?: boolean;
}

/**
 * Catálogo completo. A soma dos `percent_of_destinations` deve ser exatamente 100,
 * representando os 12% totais (D).
 */
export const DESTINATIONS: DestinationDef[] = [
  // ===== DARF — Conta Única do Tesouro (Portaria SPA/MF 1.287/2026) =====
  {
    slug: 'seguridade_social',
    name: 'Seguridade Social',
    dispositivo: 'Art. 30, §1º-A, IV-A',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 10.0,
    darf_code: '9197',
    payment_method: 'DARF código 9197 (CONTRIB.S/RECEITA LOTERIAS APOSTAS QUOTA FIXA) — Conta Única do Tesouro',
  },
  {
    slug: 'ministerio_saude',
    name: 'Ministério da Saúde',
    dispositivo: 'Art. 30, §1º-A, VI',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 1.0,
    darf_code: '6524',
    payment_method: 'DARF código 6524 (RECEITA DE LOTERIA DE APOSTAS DE QUOTA FIXA - SAÚDE)',
  },
  {
    slug: 'fnsp',
    name: 'FNSP — Fundo Nacional de Segurança Pública',
    dispositivo: 'Art. 30, §1º-A, II, "a"',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 12.6,
    darf_code: '5862',
    payment_method: 'DARF código 5862 (PARTICIP. UNIÃO REC.LOTER.APOSTAS QUOTA FIXA)',
  },
  {
    slug: 'sisfron',
    name: 'Sisfron — Sistema Integrado de Monitoramento de Fronteiras',
    dispositivo: 'Art. 30, §1º-A, II, "b"',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 1.0,
    darf_code: '5862',
    payment_method: 'DARF código 5862',
  },
  {
    slug: 'ministerio_esporte',
    name: 'Ministério do Esporte',
    dispositivo: 'Art. 30, §1º-A, III, "h"',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 22.2,
    darf_code: '5862',
    payment_method: 'DARF código 5862',
  },
  {
    slug: 'secretarias_esporte_estados',
    name: 'Secretarias de Esporte (Estados e DF)',
    dispositivo: 'Art. 30, §1º-A, III, "i"',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 0.7,
    darf_code: '5862',
    payment_method: 'DARF código 5862',
  },
  {
    slug: 'embratur',
    name: 'Embratur',
    dispositivo: 'Art. 30, §1º-A, V, "a"',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 5.6,
    darf_code: '5862',
    payment_method: 'DARF código 5862',
  },
  {
    slug: 'ministerio_turismo',
    name: 'Ministério do Turismo',
    dispositivo: 'Art. 30, §1º-A, V, "b"',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 22.4,
    darf_code: '5862',
    payment_method: 'DARF código 5862',
  },
  {
    slug: 'funapol_viii',
    name: 'FUNAPOL (inciso VIII)',
    dispositivo: 'Art. 30, §1º-A, VIII',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 0.5,
    darf_code: '5862',
    payment_method: 'DARF código 5862 (acrescenta 0,06% s/ GGR ao caput escalonado)',
  },
  {
    slug: 'abdi',
    name: 'ABDI — Agência Brasileira de Desenvolvimento Industrial',
    dispositivo: 'Art. 30, §1º-A, IX',
    category: 'CONTA_UNICA_TESOURO',
    percent_of_destinations: 0.4,
    darf_code: '5862',
    payment_method: 'DARF código 5862',
  },

  // ===== Entidades privadas (transferência bancária a contas designadas) =====
  {
    slug: 'cob',
    name: 'COB — Comitê Olímpico Brasileiro',
    dispositivo: 'Art. 30, §1º-A, III, "b"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 2.2,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF (acesso restrito)',
  },
  {
    slug: 'cpb',
    name: 'CPB — Comitê Paralímpico Brasileiro',
    dispositivo: 'Art. 30, §1º-A, III, "c"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 1.3,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'cbc',
    name: 'CBC — Comitê Brasileiro de Clubes',
    dispositivo: 'Art. 30, §1º-A, III, "d"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.7,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'cbde',
    name: 'CBDE — Confederação Brasileira de Desporto Escolar',
    dispositivo: 'Art. 30, §1º-A, III, "e"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.5,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'cbdu',
    name: 'CBDU — Confederação Brasileira de Desporto Universitário',
    dispositivo: 'Art. 30, §1º-A, III, "f"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.5,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'cbcp',
    name: 'CBCP — Comitê Brasileiro de Clubes Paralímpicos',
    dispositivo: 'Art. 30, §1º-A, III, "g"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.3,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'cbem',
    name: 'CBEM — Confederação Brasileira do Esporte Master',
    dispositivo: 'Art. 30, §1º-A, III, "j"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.3,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'fenapaes',
    name: 'Fenapaes — Federação Nacional das APAEs',
    dispositivo: 'Art. 30, §1º-A, VII, "a"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.2,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'fenapestalozzi',
    name: 'Fenapestalozzi — Federação Nacional das Pestalozzis',
    dispositivo: 'Art. 30, §1º-A, VII, "b"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.2,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },
  {
    slug: 'cruz_vermelha',
    name: 'Cruz Vermelha Brasileira',
    dispositivo: 'Art. 30, §1º-A, VII, "c"',
    category: 'ENTIDADE_PRIVADA',
    percent_of_destinations: 0.1,
    payment_method: 'Transferência bancária — dados informados pela SPA/MF',
  },

  // ===== Educação (Portaria MEC 1.240/2024 e 772/2025) =====
  {
    slug: 'educacao_a',
    name: 'Educação — alínea "a"',
    dispositivo: 'Art. 30, §1º-A, I, "a"',
    category: 'EDUCACAO',
    percent_of_destinations: 6.5,
    payment_method: 'Conforme Portaria MEC nº 1.240/2024 e nº 772/2025',
  },
  {
    slug: 'educacao_b',
    name: 'Educação — alínea "b"',
    dispositivo: 'Art. 30, §1º-A, I, "b"',
    category: 'EDUCACAO',
    percent_of_destinations: 3.5,
    payment_method: 'Conforme Portaria MEC nº 1.240/2024 e nº 772/2025',
  },

  // ===== Imagem / Propriedade intelectual (Portaria SPA/MF 41/2025) =====
  {
    slug: 'imagem_sistema_nacional_esporte',
    name: 'Entidades do Sistema Nacional do Esporte (direitos de imagem)',
    dispositivo: 'Art. 30, §1º-A, III, "a", §§ 6º e 7º',
    category: 'IMAGEM_PROP_INTELECTUAL',
    percent_of_destinations: 7.3,
    per_competition: true,
    payment_method: 'Rateio por competição esportiva conforme regulamento (Portaria SPA/MF 41/2025) — beneficiários definidos previamente em regulamento ou instrumento congênere',
  },
];

/* ============================================================
 * Cálculo
 * ============================================================ */

function applyPercent(amount: bigint, ratePercent: number): bigint {
  // 4 casas de precisão: rate × 10000.
  const factor = BigInt(Math.round(ratePercent * 10000));
  return (amount * factor) / BigInt(1_000_000);
}

/** Alíquota total das Destinações de que trata o §1º-A (D). */
export const DESTINATIONS_TOTAL_RATE = 12.0;

/**
 * Alíquota do FUNAPOL caput sobre o GGR, escalonada por ano:
 *   - Antes de abril/2026: 0%
 *   - 2026 (a partir de 1º/abr): 1,0%
 *   - 2027 (a partir de 1º/jan): 2,0%
 *   - 2028 em diante: 3,0%
 *
 * Base: GGR (= produto da arrecadação após dedução dos incisos III e V).
 * O 0,06% adicional decorrente do §1º-E inciso VIII (FUNAPOL_VIII) já está
 * contabilizado dentro dos 12% — não é somado aqui para evitar duplicidade.
 */
export function funapolCaputRateForYear(year: number, month?: number): number {
  if (year >= 2028) return 3.0;
  if (year >= 2027) return 2.0;
  if (year === 2026 && (month ?? 12) >= 4) return 1.0;
  return 0;
}

export interface BeneficiaryAmount {
  destination: DestinationDef;
  /** Alíquota efetiva sobre o GGR (= percent_of_destinations × 12% / 100). */
  effective_rate_on_ggr: number;
  /** Valor em centavos. */
  valor_centavos: bigint;
}

export interface CategoryBreakdown {
  category: DestinationCategory;
  beneficiaries: BeneficiaryAmount[];
  /** Total da categoria em centavos. */
  total_centavos: bigint;
}

export interface DarfCodeBreakdown {
  codigo: DarfCode;
  descricao: string;
  beneficiaries: BeneficiaryAmount[];
  total_centavos: bigint;
  /** Inclui o FUNAPOL caput escalonado quando codigo === '5862'. */
  includes_funapol_caput?: boolean;
}

export interface FunapolCaputBreakdown {
  ref_year: number;
  ref_month: number;
  rate_on_ggr: number;
  valor_centavos: bigint;
}

export interface DestinationsBreakdown {
  ggr_centavos: bigint;
  /** Base dos 12% destinações (= 12% × GGR, em centavos). */
  base_destinacoes_centavos: bigint;
  /** Detalhamento por categoria (CONTA_UNICA, ENTIDADE_PRIVADA, etc.). */
  categories: CategoryBreakdown[];
  /** Detalhamento dos códigos DARF agregados (para emissão das guias). */
  darf_codes: DarfCodeBreakdown[];
  /** Total das destinações dos 12% (deveria ser ≈ 12% × GGR). */
  total_destinacoes_12pct_centavos: bigint;
  /** FUNAPOL caput escalonado, se aplicável ao período. */
  funapol_caput: FunapolCaputBreakdown | null;
  /** Total geral a recolher = 12% destinações + FUNAPOL caput. */
  total_recolhimento_centavos: bigint;
  /** Alíquota efetiva sobre o GGR (e.g. 13.0 em 2026, 14.0 em 2027). */
  effective_total_rate_pct: number;
}

const DARF_CODE_LABELS: Record<DarfCode, string> = {
  '9197': 'CONTRIB.S/RECEITA LOTERIAS APOSTAS QUOTA FIXA',
  '6524': 'RECEITA DE LOTERIA DE APOSTAS DE QUOTA FIXA - SAÚDE',
  '5862': 'PARTICIP. UNIÃO REC.LOTER.APOSTAS QUOTA FIXA',
};

/**
 * Calcula o desdobramento completo das destinações sobre o GGR de um período.
 *
 * @param ggr_centavos GGR em centavos (apostas − prêmios − IR sobre prêmios).
 * @param refYear Ano de referência da apuração — usado para FUNAPOL caput escalonado.
 * @param refMonth Mês de referência (1-12).
 */
export function calculateAllDestinations(
  ggr_centavos: bigint,
  refYear: number,
  refMonth: number,
): DestinationsBreakdown {
  const ggr = ggr_centavos > 0n ? ggr_centavos : 0n;
  const base12 = applyPercent(ggr, DESTINATIONS_TOTAL_RATE);

  // Calcula valor de cada beneficiário a partir de P × 12% sobre o GGR.
  const beneficiariesAll: BeneficiaryAmount[] = DESTINATIONS.map(d => {
    const effective_rate = (d.percent_of_destinations * DESTINATIONS_TOTAL_RATE) / 100;
    return {
      destination: d,
      effective_rate_on_ggr: effective_rate,
      valor_centavos: applyPercent(ggr, effective_rate),
    };
  });

  // Agrupa por categoria.
  const grouped: Record<DestinationCategory, BeneficiaryAmount[]> = {
    CONTA_UNICA_TESOURO: [],
    ENTIDADE_PRIVADA: [],
    EDUCACAO: [],
    IMAGEM_PROP_INTELECTUAL: [],
  };
  for (const b of beneficiariesAll) grouped[b.destination.category].push(b);

  const categories: CategoryBreakdown[] = (
    Object.keys(grouped) as DestinationCategory[]
  ).map(cat => ({
    category: cat,
    beneficiaries: grouped[cat],
    total_centavos: grouped[cat].reduce((s, b) => s + b.valor_centavos, 0n),
  }));

  // Agrupa por código DARF (só os que vão à Conta Única).
  const darfMap = new Map<DarfCode, BeneficiaryAmount[]>();
  for (const b of grouped.CONTA_UNICA_TESOURO) {
    const code = b.destination.darf_code;
    if (!code) continue;
    if (!darfMap.has(code)) darfMap.set(code, []);
    darfMap.get(code)!.push(b);
  }

  // FUNAPOL caput — escalonado, sobre GGR.
  const caputRate = funapolCaputRateForYear(refYear, refMonth);
  const funapol_caput: FunapolCaputBreakdown | null = caputRate > 0
    ? {
        ref_year: refYear,
        ref_month: refMonth,
        rate_on_ggr: caputRate,
        valor_centavos: applyPercent(ggr, caputRate),
      }
    : null;

  // Monta detalhamento DARF — anexa FUNAPOL caput ao código 5862.
  const darf_codes: DarfCodeBreakdown[] = (['9197', '6524', '5862'] as DarfCode[]).map(codigo => {
    const benefs = darfMap.get(codigo) ?? [];
    let total = benefs.reduce((s, b) => s + b.valor_centavos, 0n);
    let includes_funapol_caput = false;
    if (codigo === '5862' && funapol_caput) {
      total += funapol_caput.valor_centavos;
      includes_funapol_caput = true;
    }
    return {
      codigo,
      descricao: DARF_CODE_LABELS[codigo],
      beneficiaries: benefs,
      total_centavos: total,
      includes_funapol_caput,
    };
  });

  const total_destinacoes_12pct = beneficiariesAll.reduce((s, b) => s + b.valor_centavos, 0n);
  const total_recolhimento = total_destinacoes_12pct + (funapol_caput?.valor_centavos ?? 0n);
  const effective_total_rate = DESTINATIONS_TOTAL_RATE + caputRate;

  return {
    ggr_centavos: ggr,
    base_destinacoes_centavos: base12,
    categories,
    darf_codes,
    total_destinacoes_12pct_centavos: total_destinacoes_12pct,
    funapol_caput,
    total_recolhimento_centavos: total_recolhimento,
    effective_total_rate_pct: effective_total_rate,
  };
}

/* ============================================================
 * Compatibilidade — interface antiga `DarfBreakdown` mantida para
 * páginas/exports que ainda consomem por código DARF.
 * ============================================================ */

export interface DarfBeneficiaryAmount {
  beneficiario: {
    name: string;
    dispositivo: string;
    /** Percentual P (% das destinações totais). */
    percentual_no_codigo: number;
    slug: string;
  };
  valor_centavos: bigint;
}

export interface DarfCodeAmount {
  codigo: DarfCode;
  descricao: string;
  tipo: 'contribuicao' | 'participacao_patrimonial';
  /** Alíquota efetiva sobre o GGR para o código (somatório dos beneficiários
   *  do código + FUNAPOL caput, quando aplicável). */
  percentual_do_ggr: number;
  valor_total_centavos: bigint;
  beneficiarios: DarfBeneficiaryAmount[];
}

export interface DarfBreakdown {
  ggr_centavos: bigint;
  total_recolhimento_centavos: bigint;
  codigos: DarfCodeAmount[];
}

const DARF_CODE_TIPO: Record<DarfCode, 'contribuicao' | 'participacao_patrimonial'> = {
  '9197': 'contribuicao',
  '6524': 'contribuicao',
  '5862': 'participacao_patrimonial',
};

/**
 * Interface legacy: retorna apenas a parte DARF (Conta Única do Tesouro).
 * Inclui FUNAPOL caput como linha adicional dentro do DARF 5862.
 */
export function calculateDarfBreakdown(ggr_centavos: bigint, refYear?: number, refMonth?: number): DarfBreakdown {
  const year = refYear ?? new Date().getFullYear();
  const month = refMonth ?? (new Date().getMonth() + 1);
  const full = calculateAllDestinations(ggr_centavos, year, month);

  const codigos: DarfCodeAmount[] = full.darf_codes.map(c => {
    const beneficiarios: DarfBeneficiaryAmount[] = c.beneficiaries.map(b => ({
      beneficiario: {
        name: b.destination.name,
        dispositivo: b.destination.dispositivo,
        percentual_no_codigo: b.destination.percent_of_destinations,
        slug: b.destination.slug,
      },
      valor_centavos: b.valor_centavos,
    }));
    if (c.codigo === '5862' && full.funapol_caput) {
      beneficiarios.push({
        beneficiario: {
          name: `FUNAPOL (caput, ${full.funapol_caput.rate_on_ggr.toLocaleString('pt-BR')}% s/ GGR)`,
          dispositivo: 'Art. 30, §1º-A, caput (MP 1.348/2026)',
          percentual_no_codigo: -1, // marcador: aplicado direto sobre o GGR
          slug: 'funapol_caput',
        },
        valor_centavos: full.funapol_caput.valor_centavos,
      });
    }

    const sumRate = c.beneficiaries.reduce((s, b) => s + b.effective_rate_on_ggr, 0)
      + (c.codigo === '5862' ? (full.funapol_caput?.rate_on_ggr ?? 0) : 0);

    return {
      codigo: c.codigo,
      descricao: c.descricao,
      tipo: DARF_CODE_TIPO[c.codigo],
      percentual_do_ggr: Number(sumRate.toFixed(4)),
      valor_total_centavos: c.total_centavos,
      beneficiarios,
    };
  });

  const totalDarf = codigos.reduce((s, c) => s + c.valor_total_centavos, 0n);

  return {
    ggr_centavos: full.ggr_centavos,
    total_recolhimento_centavos: totalDarf,
    codigos,
  };
}

/* ============================================================
 * Helpers de exibição
 * ============================================================ */

export const CATEGORY_LABELS: Record<DestinationCategory, string> = {
  CONTA_UNICA_TESOURO: 'Conta Única do Tesouro (DARF)',
  ENTIDADE_PRIVADA: 'Entidades privadas (transferência bancária)',
  EDUCACAO: 'Educação (Portaria MEC 1.240/2024)',
  IMAGEM_PROP_INTELECTUAL: 'Direitos de imagem (rateado por competição)',
};

export const CATEGORY_DESCRIPTIONS: Record<DestinationCategory, string> = {
  CONTA_UNICA_TESOURO:
    'Recolhimento via DARF nos códigos 9197 (Contribuição/Seguridade), 6524 (Saúde) e 5862 (Participação Patrimonial). FUNAPOL caput escalonado também é recolhido via 5862.',
  ENTIDADE_PRIVADA:
    'Pagamento por transferência bancária a contas designadas pelas entidades. A SPA/MF informa os dados bancários aos agentes operadores (acesso restrito).',
  EDUCACAO:
    'Pagamento conforme Portaria MEC nº 1.240/2024 e nº 772/2025 — distribuição entre os fundos federais de educação.',
  IMAGEM_PROP_INTELECTUAL:
    'Repasse calculado em duas fases: (1) rateio do total por competição esportiva proporcional à arrecadação do evento; (2) reversão para os beneficiários conforme regulamento da competição (Portaria SPA/MF nº 41/2025). Beneficiários precisam ser estipulados ANTES da oferta da aposta.',
};
