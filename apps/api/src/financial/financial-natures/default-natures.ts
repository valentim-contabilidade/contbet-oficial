import { DreSection, NatureType } from '@prisma/client';

/**
 * Naturezas Contábeis padrão para casas de apostas.
 *
 * Estas 16 naturezas são criadas automaticamente quando:
 *   1. Uma empresa é criada (via CompanyService já existente)
 *   2. O endpoint de seed é chamado para empresas existentes
 *
 * Cada natureza define EM QUAL LINHA da DRE o lançamento aparecerá.
 * O usuário pode editar/desativar, mas as 16 padrões cobrem o cenário típico.
 */

export interface NatureSeed {
  name: string;
  type: NatureType;
  dre_section: DreSection;
  dre_order: number;
  description: string;
  accounting_code?: string;
}

export const DEFAULT_NATURES: NatureSeed[] = [
  // === RECEITAS OPERACIONAIS (4 naturezas) ===
  {
    name: 'GGR (Receita de Apostas)',
    type: NatureType.RECEITA,
    dre_section: DreSection.RECEITA_OPERACIONAL,
    dre_order: 1,
    description: 'Gross Gaming Revenue. Apostas recebidas - prêmios pagos. Valor consolidado a partir do módulo GGR.',
    accounting_code: '3.1.01',
  },
  {
    name: 'Receita de Serviços',
    type: NatureType.RECEITA,
    dre_section: DreSection.RECEITA_OPERACIONAL,
    dre_order: 2,
    description: 'Serviços prestados (NFSe emitidas), taxas de plataforma, licenciamentos.',
    accounting_code: '3.1.02',
  },
  {
    name: 'Outras Receitas Operacionais',
    type: NatureType.RECEITA,
    dre_section: DreSection.RECEITA_OPERACIONAL,
    dre_order: 3,
    description: 'Patrocínios, parcerias comerciais, publicidade, demais receitas relacionadas à atividade-fim.',
    accounting_code: '3.1.03',
  },
  {
    name: 'Receita Financeira',
    type: NatureType.RECEITA,
    dre_section: DreSection.RECEITA_FINANCEIRA,
    dre_order: 1,
    description: 'Juros recebidos, rendimentos de aplicações financeiras, descontos obtidos.',
    accounting_code: '3.2.01',
  },

  // === DEDUÇÕES DA RECEITA (3 naturezas) ===
  {
    name: 'Tributos sobre Receita - Lei 14.790',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 1,
    description: 'Imposto de 12% sobre a receita líquida de apostas conforme Lei 14.790/2023.',
    accounting_code: '3.1.91',
  },
  {
    name: 'PIS / COFINS sobre Receita',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 2,
    description: 'PIS e COFINS sobre faturamento (não-cumulativo: 1,65% + 7,60% / cumulativo: 0,65% + 3,00%).',
    accounting_code: '3.1.92',
  },
  {
    name: 'ISS sobre Serviços',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 3,
    description: 'Imposto sobre Serviços de Qualquer Natureza (alíquota varia por município).',
    accounting_code: '3.1.93',
  },

  // === CUSTOS OPERACIONAIS (1 natureza) ===
  {
    name: 'Prêmios Pagos a Apostadores',
    type: NatureType.DESPESA,
    dre_section: DreSection.CUSTO_OPERACIONAL,
    dre_order: 1,
    description: 'Prêmios pagos aos apostadores. Calculado automaticamente a partir do módulo GGR.',
    accounting_code: '4.1.01',
  },

  // === DESPESAS OPERACIONAIS (5 naturezas) ===
  {
    name: 'Despesas com Pessoal',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_OPERACIONAL,
    dre_order: 1,
    description: 'Salários, encargos sociais (INSS, FGTS), benefícios, vales, 13º salário, férias, rescisões.',
    accounting_code: '4.2.01',
  },
  {
    name: 'Despesas Administrativas',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_OPERACIONAL,
    dre_order: 2,
    description: 'Aluguel, energia elétrica, água, internet, telefonia, material de escritório, viagens.',
    accounting_code: '4.2.02',
  },
  {
    name: 'Despesas Comerciais e Marketing',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_OPERACIONAL,
    dre_order: 3,
    description: 'Marketing digital, mídia paga, comissões de afiliados, patrocínios, eventos, brindes.',
    accounting_code: '4.2.03',
  },
  {
    name: 'Despesas Tecnológicas',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_OPERACIONAL,
    dre_order: 4,
    description: 'Plataforma de apostas, licenças de software, hospedagem em nuvem, gateways de pagamento, KYC.',
    accounting_code: '4.2.04',
  },
  {
    name: 'Despesas Tributárias Operacionais',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_OPERACIONAL,
    dre_order: 5,
    description: 'Taxas, alvarás, IPVA, IPTU, contribuições sindicais, demais tributos não vinculados à receita.',
    accounting_code: '4.2.05',
  },

  // === DESPESA NÃO OPERACIONAL (1 natureza) ===
  {
    name: 'Despesas Não Operacionais',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_NAO_OPERACIONAL,
    dre_order: 1,
    description: 'Multas, indenizações, doações sem incentivo fiscal, perdas eventuais, despesas de exercícios anteriores.',
    accounting_code: '4.3.01',
  },

  // === DESPESA FINANCEIRA (1 natureza) ===
  {
    name: 'Despesas Financeiras',
    type: NatureType.DESPESA,
    dre_section: DreSection.DESPESA_FINANCEIRA,
    dre_order: 1,
    description: 'Juros pagos, IOF, tarifas bancárias, descontos concedidos, variação cambial passiva.',
    accounting_code: '4.4.01',
  },

  // === IMPOSTOS SOBRE LUCRO (1 natureza) ===
  {
    name: 'IRPJ + CSLL',
    type: NatureType.DESPESA,
    dre_section: DreSection.IMPOSTO_LUCRO,
    dre_order: 1,
    description: 'Imposto de Renda Pessoa Jurídica e Contribuição Social. Calculado automaticamente pelo módulo Tributário (Lucro Real).',
    accounting_code: '4.9.01',
  },
];

/**
 * Cria as 16 naturezas padrão para uma empresa.
 * Idempotente: não cria duplicatas se já existirem.
 */
export async function seedDefaultNaturesForCompany(
  prisma: any,
  companyId: string,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const seed of DEFAULT_NATURES) {
    const existing = await prisma.financialNature.findFirst({
      where: {
        company_id: companyId,
        name: seed.name,
        metadeleted: false,
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.financialNature.create({
      data: {
        ...seed,
        company_id: companyId,
        is_default: true,
      },
    });
    created++;
  }

  return { created, skipped };
}
