import { AccountType } from '@prisma/client';

/**
 * Plano de contas mínimo para operadoras de apostas regidas pela Lei 14.790/2023.
 * Estrutura segue padrão CPC (1=ATIVO, 2=PASSIVO, 3=PATRIMÔNIO LÍQUIDO, 4=RESULTADO).
 *
 * O `code` final fica na conta analítica; as sintéticas (cabeçalho de grupo) são
 * marcadas como `is_synthetic` apenas para compor a hierarquia.
 */
export interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
  parent_code: string | null;
}

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  // ===== ATIVO =====
  { code: '1',         name: 'ATIVO',                                       type: AccountType.ASSET, parent_code: null },
  { code: '1.1',       name: 'Ativo Circulante',                            type: AccountType.ASSET, parent_code: '1' },
  { code: '1.1.1',     name: 'Caixa e Equivalentes',                        type: AccountType.ASSET, parent_code: '1.1' },
  { code: '1.1.1.01',  name: 'Banco Conta Movimento',                       type: AccountType.ASSET, parent_code: '1.1.1' },
  { code: '1.1.1.02',  name: 'Banco Conta Segregada Apostadores',           type: AccountType.ASSET, parent_code: '1.1.1' },
  { code: '1.1.1.03',  name: 'PSP / Gateway de Pagamentos',                 type: AccountType.ASSET, parent_code: '1.1.1' },
  { code: '1.1.2',     name: 'Contas a Receber',                            type: AccountType.ASSET, parent_code: '1.1' },
  { code: '1.1.2.01',  name: 'Clientes / Recebíveis',                       type: AccountType.ASSET, parent_code: '1.1.2' },

  // ===== PASSIVO =====
  { code: '2',         name: 'PASSIVO',                                     type: AccountType.LIABILITY, parent_code: null },
  { code: '2.1',       name: 'Passivo Circulante',                          type: AccountType.LIABILITY, parent_code: '2' },
  { code: '2.1.1',     name: 'Fornecedores',                                type: AccountType.LIABILITY, parent_code: '2.1' },
  { code: '2.1.1.01',  name: 'Fornecedores Nacionais',                      type: AccountType.LIABILITY, parent_code: '2.1.1' },
  { code: '2.1.2',     name: 'Obrigações Trabalhistas',                     type: AccountType.LIABILITY, parent_code: '2.1' },
  { code: '2.1.2.01',  name: 'Salários a Pagar',                            type: AccountType.LIABILITY, parent_code: '2.1.2' },
  { code: '2.1.4',     name: 'Tributos a Recolher',                         type: AccountType.LIABILITY, parent_code: '2.1' },
  { code: '2.1.4.01',  name: 'IRPJ a Recolher',                             type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.02',  name: 'CSLL a Recolher',                             type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.03',  name: 'PIS a Recolher',                              type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.04',  name: 'COFINS a Recolher',                           type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.05',  name: 'ISS a Recolher',                              type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.06',     name: 'Tributo Lei 14.790 a Recolher',                              type: AccountType.LIABILITY, parent_code: '2.1.4' },
  // Sub-contas por código DARF — Conta Única do Tesouro (Portaria SPA/MF 1.287/2026).
  // DARF 5862 inclui o FUNAPOL caput escalonado (1% em 2026, 2% em 2027, 3% em 2028).
  { code: '2.1.4.06.01',  name: 'DARF 9197 · Seguridade Social a Recolher',                   type: AccountType.LIABILITY, parent_code: '2.1.4.06' },
  { code: '2.1.4.06.02',  name: 'DARF 6524 · Ministério da Saúde a Recolher',                 type: AccountType.LIABILITY, parent_code: '2.1.4.06' },
  { code: '2.1.4.06.03',  name: 'DARF 5862 · Participação União a Recolher',                  type: AccountType.LIABILITY, parent_code: '2.1.4.06' },
  { code: '2.1.4.07',     name: 'IRRF Prêmios a Recolher',                                    type: AccountType.LIABILITY, parent_code: '2.1.4' },
  // Retenções de tributos federais sobre serviços tomados de PJ (CSRF — Lei 9.430/96 + IN RFB 459/04)
  { code: '2.1.4.08',  name: 'IRRF s/ Serviços PJ a Recolher',              type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.09',  name: 'CSLL Retida na Fonte a Recolher',             type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.10',  name: 'PIS Retido na Fonte a Recolher',              type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.11',  name: 'COFINS Retido na Fonte a Recolher',           type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.5',     name: 'Carteira de Apostadores',                     type: AccountType.LIABILITY, parent_code: '2.1' },
  { code: '2.1.5.01',  name: 'Saldo de Apostadores',                        type: AccountType.LIABILITY, parent_code: '2.1.5' },
  // Repasses da Lei 14.790 que NÃO passam pelo DARF — pagos por transferência
  // bancária ou rateio por competição (Manual SPA/MF 08/05/2026).
  { code: '2.1.6',        name: 'Repasses Lei 14.790 (não-DARF) a Pagar',                     type: AccountType.LIABILITY, parent_code: '2.1' },
  { code: '2.1.6.01',     name: 'Repasses a Entidades Privadas (COB/CPB/CBC/Fenapaes/etc.)',  type: AccountType.LIABILITY, parent_code: '2.1.6' },
  { code: '2.1.6.02',     name: 'Repasses Educação (Portaria MEC 1.240/2024)',                type: AccountType.LIABILITY, parent_code: '2.1.6' },
  { code: '2.1.6.03',     name: 'Repasses Direitos de Imagem (Portaria SPA/MF 41/2025)',      type: AccountType.LIABILITY, parent_code: '2.1.6' },

  // ===== PATRIMÔNIO LÍQUIDO =====
  { code: '3',         name: 'PATRIMÔNIO LÍQUIDO',                          type: AccountType.EQUITY, parent_code: null },
  { code: '3.1',       name: 'Capital Social',                              type: AccountType.EQUITY, parent_code: '3' },
  { code: '3.1.01',    name: 'Capital Social Subscrito',                    type: AccountType.EQUITY, parent_code: '3.1' },
  { code: '3.2',       name: 'Reservas e Resultados',                       type: AccountType.EQUITY, parent_code: '3' },
  { code: '3.2.01',    name: 'Lucros/Prejuízos Acumulados',                 type: AccountType.EQUITY, parent_code: '3.2' },

  // ===== RECEITAS =====
  { code: '4',         name: 'RECEITAS',                                    type: AccountType.REVENUE, parent_code: null },
  { code: '4.1',       name: 'Receita Operacional',                         type: AccountType.REVENUE, parent_code: '4' },
  { code: '4.1.1',     name: 'Receita Bruta de Apostas',                    type: AccountType.REVENUE, parent_code: '4.1' },
  { code: '4.1.1.01',  name: 'GGR · Receita Bruta de Jogo',                 type: AccountType.REVENUE, parent_code: '4.1.1' },
  { code: '4.1.2',     name: 'Receitas Financeiras',                        type: AccountType.REVENUE, parent_code: '4.1' },
  { code: '4.1.2.01',  name: 'Juros Recebidos',                             type: AccountType.REVENUE, parent_code: '4.1.2' },
  { code: '4.1.2.02',  name: 'Outras Receitas Financeiras',                 type: AccountType.REVENUE, parent_code: '4.1.2' },
  { code: '4.2',       name: 'Outras Receitas (Não-Operacionais)',          type: AccountType.REVENUE, parent_code: '4' },
  { code: '4.2.01',    name: 'Recuperação Tributária',                      type: AccountType.REVENUE, parent_code: '4.2' },
  { code: '4.2.02',    name: 'Royalties / Licenciamento',                   type: AccountType.REVENUE, parent_code: '4.2' },
  { code: '4.2.03',    name: 'Reembolsos Recebidos',                        type: AccountType.REVENUE, parent_code: '4.2' },
  { code: '4.2.99',    name: 'Outras Receitas Não-Operacionais',            type: AccountType.REVENUE, parent_code: '4.2' },

  // ===== DESPESAS =====
  { code: '5',         name: 'DESPESAS',                                    type: AccountType.EXPENSE, parent_code: null },
  { code: '5.1',       name: 'Despesas Tributárias',                        type: AccountType.EXPENSE, parent_code: '5' },
  { code: '5.1.01',       name: 'Tributo Lei 14.790',                                         type: AccountType.EXPENSE, parent_code: '5.1' },
  // Sub-contas de despesa por código DARF (espelham 2.1.4.06.x)
  { code: '5.1.01.01',    name: 'DARF 9197 · Seguridade Social',                              type: AccountType.EXPENSE, parent_code: '5.1.01' },
  { code: '5.1.01.02',    name: 'DARF 6524 · Ministério da Saúde',                            type: AccountType.EXPENSE, parent_code: '5.1.01' },
  { code: '5.1.01.03',    name: 'DARF 5862 · Participação União (inclui FUNAPOL caput)',      type: AccountType.EXPENSE, parent_code: '5.1.01' },
  // Repasses não-DARF da Lei 14.790 (espelham 2.1.6.x)
  { code: '5.1.07',       name: 'Repasses Lei 14.790 — Entidades Privadas',                   type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.08',       name: 'Repasses Lei 14.790 — Educação',                             type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.09',       name: 'Repasses Lei 14.790 — Direitos de Imagem',                   type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.02',       name: 'PIS sobre Receita',                                          type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.03',    name: 'COFINS sobre Receita',                        type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.04',    name: 'ISS',                                         type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.05',    name: 'IRPJ',                                        type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.06',    name: 'CSLL',                                        type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.2',       name: 'Despesas Operacionais',                       type: AccountType.EXPENSE, parent_code: '5' },
  { code: '5.2.01',    name: 'Salários e Encargos',                         type: AccountType.EXPENSE, parent_code: '5.2' },
  { code: '5.2.02',    name: 'Aluguel e Ocupação',                          type: AccountType.EXPENSE, parent_code: '5.2' },
  { code: '5.2.03',    name: 'Tecnologia e Plataforma',                     type: AccountType.EXPENSE, parent_code: '5.2' },
  { code: '5.2.04',    name: 'Marketing e Patrocínios',                     type: AccountType.EXPENSE, parent_code: '5.2' },
  { code: '5.2.05',    name: 'Serviços de Terceiros',                       type: AccountType.EXPENSE, parent_code: '5.2' },
  { code: '5.2.99',    name: 'Outras Despesas Operacionais',                type: AccountType.EXPENSE, parent_code: '5.2' },
];

/**
 * Cria as contas faltantes do plano padrão para uma empresa.
 * Idempotente: se a conta já existir (mesmo código), não faz nada.
 */
export async function syncDefaultChartOfAccountsForCompany(
  prisma: any,
  companyId: string,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const codeToId = new Map<string, string>();

  // Pré-carrega contas existentes
  const existing = await prisma.chartOfAccount.findMany({
    where: { company_id: companyId, metadeleted: false },
  });
  for (const a of existing) codeToId.set(a.code, a.id);

  for (const def of DEFAULT_CHART_OF_ACCOUNTS) {
    if (codeToId.has(def.code)) { skipped++; continue; }
    const parent_id = def.parent_code ? codeToId.get(def.parent_code) ?? null : null;
    const acct = await prisma.chartOfAccount.create({
      data: {
        code: def.code,
        name: def.name,
        type: def.type,
        parent_id,
        company_id: companyId,
        is_active: true,
      },
    });
    codeToId.set(acct.code, acct.id);
    created++;
  }

  return { created, skipped };
}
