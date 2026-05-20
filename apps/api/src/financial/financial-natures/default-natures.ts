import { DreSection, NatureType } from '@prisma/client';
import { syncDefaultChartOfAccountsForCompany } from '../chart-of-accounts/default-accounts';

/**
 * Naturezas Contábeis padrão para casas de apostas.
 *
 * Estas 19 naturezas são criadas automaticamente quando:
 *   1. Uma empresa é criada (via CompanyService já existente)
 *   2. O endpoint de seed é chamado para empresas existentes
 *
 * Cada natureza define EM QUAL LINHA da DRE o lançamento aparecerá.
 * O usuário pode editar/desativar, mas as 19 padrões cobrem o cenário típico.
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

  // === DEDUÇÕES DA RECEITA (6 naturezas) ===
  // Destinações da Lei 14.790 segregadas conforme manual SPA/MF (08/05/2026):
  //   - DARF (Conta Única do Tesouro): códigos 9197, 6524 e 5862 (inclui FUNAPOL caput)
  //   - Entidades privadas: COB, CPB, CBC, CBDE, CBDU, CBCP, CBEM, Fenapaes, Fenapestalozzi, Cruz Vermelha
  //   - Educação: Portaria MEC nº 1.240/2024 e nº 772/2025
  //   - Direitos de imagem: Portaria SPA/MF nº 41/2025 (rateado por competição)
  // Total = 13% do GGR em 2026 (12% destinações + 1% FUNAPOL caput escalonado).
  {
    name: 'Lei 14.790 — DARF Conta Única do Tesouro',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 1,
    description: 'Repasses ao Tesouro Nacional via DARF: códigos 9197 (Seguridade Social), 6524 (Saúde) e 5862 (Participação União — FNSP, Sisfron, Esporte, Embratur, Turismo, ABDI, FUNAPOL inciso VIII e caput escalonado). Portaria SPA/MF 1.287/2026.',
    accounting_code: '3.1.91',
  },
  {
    name: 'Lei 14.790 — Entidades Privadas',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 2,
    description: 'Repasses por transferência bancária às entidades designadas nominalmente: COB, CPB, CBC, CBDE, CBDU, CBCP, CBEM, Fenapaes, Fenapestalozzi e Cruz Vermelha Brasileira (Art. 30 §1º-A, incisos III "b–g", III "j" e VII).',
    accounting_code: '3.1.92',
  },
  {
    name: 'Lei 14.790 — Educação',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 3,
    description: 'Destinação à educação (Art. 30 §1º-A, inciso I, alíneas "a" e "b") — distribuição conforme Portaria MEC nº 1.240/2024 e nº 772/2025. 10% das destinações totais (1,2% do GGR).',
    accounting_code: '3.1.93',
  },
  {
    name: 'Lei 14.790 — Direitos de Imagem',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 4,
    description: 'Repasse às entidades do Sistema Nacional do Esporte e atletas em contrapartida ao uso de direitos de imagem e propriedade intelectual (Art. 30 §1º-A, III "a" + §§ 6º e 7º). Cálculo em duas fases por competição esportiva conforme Portaria SPA/MF nº 41/2025.',
    accounting_code: '3.1.94',
  },
  {
    name: 'PIS / COFINS sobre Receita',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 5,
    description: 'PIS e COFINS sobre faturamento (não-cumulativo: 1,65% + 7,60% / cumulativo: 0,65% + 3,00%).',
    accounting_code: '3.1.95',
  },
  {
    name: 'ISS sobre Serviços',
    type: NatureType.DESPESA,
    dre_section: DreSection.DEDUCAO_RECEITA,
    dre_order: 6,
    description: 'Imposto sobre Serviços de Qualquer Natureza (alíquota varia por município).',
    accounting_code: '3.1.96',
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
 * Cria as 19 naturezas padrão para uma empresa.
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

/**
 * Migra empresas legadas para o desdobramento completo das destinações da
 * Lei 14.790 conforme o Manual SPA/MF (08/05/2026):
 *
 *   1. Renomeia a natureza única "Tributos sobre Receita - Lei 14.790"
 *      para "Lei 14.790 — DARF Conta Única do Tesouro" — preservando o ID,
 *      para manter a integridade dos lançamentos já vinculados.
 *   2. Cria as 3 novas naturezas (Entidades Privadas, Educação, Direitos de
 *      Imagem) via `seedDefaultNaturesForCompany`.
 *   3. Reordena PIS/COFINS → dre_order=5, ISS → dre_order=6 com os novos
 *      `accounting_code` (3.1.95 e 3.1.96).
 *   4. Sincroniza o plano de contas com as sub-contas DARF (2.1.4.06.x e
 *      5.1.01.x) e com o grupo de repasses não-DARF (2.1.6.x e 5.1.07-09).
 *
 * Idempotente: pode ser executada múltiplas vezes sem efeito colateral.
 */
export async function migrateLei14790ForCompany(
  prisma: any,
  companyId: string,
): Promise<{
  renamed_legacy_nature: boolean;
  natures_created: number;
  natures_renumbered: number;
  chart_accounts_created: number;
}> {
  const seedDarf = DEFAULT_NATURES.find(n => n.name === 'Lei 14.790 — DARF Conta Única do Tesouro')!;
  let renamed_legacy_nature = false;
  let natures_renumbered = 0;

  // 1) Renomeia a natureza antiga, se existir e a nova ainda não existir.
  const legacy = await prisma.financialNature.findFirst({
    where: {
      company_id: companyId,
      name: 'Tributos sobre Receita - Lei 14.790',
      metadeleted: false,
    },
  });
  if (legacy) {
    const alreadyHasNew = await prisma.financialNature.findFirst({
      where: { company_id: companyId, name: seedDarf.name, metadeleted: false },
    });
    if (!alreadyHasNew) {
      await prisma.financialNature.update({
        where: { id: legacy.id },
        data: {
          name: seedDarf.name,
          description: seedDarf.description,
          dre_order: seedDarf.dre_order,
          accounting_code: seedDarf.accounting_code,
          is_default: true,
        },
      });
      renamed_legacy_nature = true;
    }
  }

  // 2) Cria as faltantes (idempotente — não duplica).
  const seedResult = await seedDefaultNaturesForCompany(prisma, companyId);

  // 3) Reordena PIS/COFINS e ISS para liberar dre_order 1-4 às novas Lei 14.790.
  const reorderTargets: Array<{ name: string; dre_order: number; accounting_code: string }> = [
    { name: 'PIS / COFINS sobre Receita', dre_order: 5, accounting_code: '3.1.95' },
    { name: 'ISS sobre Serviços',         dre_order: 6, accounting_code: '3.1.96' },
  ];
  for (const t of reorderTargets) {
    const n = await prisma.financialNature.findFirst({
      where: { company_id: companyId, name: t.name, metadeleted: false },
    });
    if (n && (n.dre_order !== t.dre_order || n.accounting_code !== t.accounting_code)) {
      await prisma.financialNature.update({
        where: { id: n.id },
        data: { dre_order: t.dre_order, accounting_code: t.accounting_code },
      });
      natures_renumbered++;
    }
  }

  // 4) Sincroniza o plano de contas (cria sub-contas DARF + grupo não-DARF).
  const chartResult = await syncDefaultChartOfAccountsForCompany(prisma, companyId);

  return {
    renamed_legacy_nature,
    natures_created: seedResult.created,
    natures_renumbered,
    chart_accounts_created: chartResult.created,
  };
}
