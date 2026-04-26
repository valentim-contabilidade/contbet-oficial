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
  { code: '2.1.4.06',  name: 'Tributo Lei 14.790 a Recolher',               type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.4.07',  name: 'IRRF Prêmios a Recolher',                     type: AccountType.LIABILITY, parent_code: '2.1.4' },
  { code: '2.1.5',     name: 'Carteira de Apostadores',                     type: AccountType.LIABILITY, parent_code: '2.1' },
  { code: '2.1.5.01',  name: 'Saldo de Apostadores',                        type: AccountType.LIABILITY, parent_code: '2.1.5' },

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
  { code: '5.1.01',    name: 'Tributo Lei 14.790',                          type: AccountType.EXPENSE, parent_code: '5.1' },
  { code: '5.1.02',    name: 'PIS sobre Receita',                           type: AccountType.EXPENSE, parent_code: '5.1' },
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
