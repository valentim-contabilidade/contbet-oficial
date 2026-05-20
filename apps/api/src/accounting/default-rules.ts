import { PrismaClient } from '@prisma/client';

/**
 * Catálogo de regras contábeis default — equivalente ao que estava
 * hard-coded em ACCT_CODES + roteamento nos métodos de postPayablePaid,
 * postReceivableIssued, postIrpjCsllClose etc.
 *
 * Cada item vira uma linha em `accounting_rules`. ADMIN pode editar as
 * contas (códigos), o código do histórico Domínio e o template.
 *
 * Códigos de débito/crédito apontam para CÓDIGOS do plano padrão da empresa
 * (cada empresa resolve para a sua própria ChartOfAccount via company_id+code).
 */
export interface DefaultRule {
  event_key: string;
  group: string;
  label: string;
  description?: string;
  debit_code?: string;
  credit_code?: string;
  historic_code?: number;
  historic_template?: string;
}

export const DEFAULT_ACCOUNTING_RULES: DefaultRule[] = [
  // ===== GGR Diário =====
  {
    event_key: 'GGR_DAILY.DEPOSIT',
    group: 'GGR_DAILY',
    label: 'Depósitos do dia',
    debit_code: '1.1.1.02',  // BANCO_SEGREGADO_APOSTADORES
    credit_code: '2.1.5.01', // SALDO_APOSTADORES
    historic_code: 1,
    historic_template: 'Depósitos do dia · {brand} · {date}',
  },
  {
    event_key: 'GGR_DAILY.WITHDRAWAL',
    group: 'GGR_DAILY',
    label: 'Saques do dia',
    debit_code: '2.1.5.01',
    credit_code: '1.1.1.02',
    historic_code: 2,
    historic_template: 'Saques do dia · {brand} · {date}',
  },
  {
    event_key: 'GGR_DAILY.GGR_POSITIVE',
    group: 'GGR_DAILY',
    label: 'GGR positivo (apostas − prêmios > 0)',
    debit_code: '2.1.5.01',
    credit_code: '4.1.1.01',
    historic_code: 3,
    historic_template: 'GGR · {brand} · {date}',
  },
  {
    event_key: 'GGR_DAILY.GGR_NEGATIVE',
    group: 'GGR_DAILY',
    label: 'GGR negativo (prêmios > apostas)',
    debit_code: '4.1.1.01',
    credit_code: '2.1.5.01',
    historic_code: 4,
    historic_template: 'GGR negativo · {brand} · {date}',
  },

  // ===== Pagamentos (Payable PAID) =====
  {
    event_key: 'PAYABLE_PAID.SERVICE_OPERATIONAL',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de serviço/despesa operacional',
    debit_code: '5.2.99', // DESP_OUTRAS_OPERACIONAIS
    credit_code: '1.1.1.01', // BANCO_MOVIMENTO
    historic_code: 10,
    historic_template: 'Pagamento · {fornecedor} · {documento}',
  },
  {
    event_key: 'PAYABLE_PAID.PAYROLL',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de folha',
    debit_code: '2.1.2.01', // SALARIOS_A_PAGAR
    credit_code: '1.1.1.01',
    historic_code: 11,
    historic_template: 'Pagamento de salários · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.TAX_IRPJ',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de IRPJ',
    debit_code: '2.1.4.01',
    credit_code: '1.1.1.01',
    historic_code: 20,
    historic_template: 'Recolhimento IRPJ · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.TAX_CSLL',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de CSLL',
    debit_code: '2.1.4.02',
    credit_code: '1.1.1.01',
    historic_code: 21,
    historic_template: 'Recolhimento CSLL · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.TAX_PIS',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de PIS',
    debit_code: '2.1.4.03',
    credit_code: '1.1.1.01',
    historic_code: 22,
    historic_template: 'Recolhimento PIS · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.TAX_COFINS',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de COFINS',
    debit_code: '2.1.4.04',
    credit_code: '1.1.1.01',
    historic_code: 23,
    historic_template: 'Recolhimento COFINS · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.TAX_ISS',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de ISS',
    debit_code: '2.1.4.05',
    credit_code: '1.1.1.01',
    historic_code: 24,
    historic_template: 'Recolhimento ISS · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.TAX_LEI14790',
    group: 'PAYABLE_PAID',
    label: 'Pagamento de tributo Lei 14.790',
    debit_code: '2.1.4.06',
    credit_code: '1.1.1.01',
    historic_code: 25,
    historic_template: 'Recolhimento Tributo Lei 14.790 · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.CSRF_IRRF',
    group: 'PAYABLE_PAID',
    label: 'DARF Retenção CSRF — IRRF',
    debit_code: '2.1.4.08',
    credit_code: '1.1.1.01',
    historic_code: 30,
    historic_template: 'DARF Retenção IRRF · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.CSRF_CSLL',
    group: 'PAYABLE_PAID',
    label: 'DARF Retenção CSRF — CSLL',
    debit_code: '2.1.4.09',
    credit_code: '1.1.1.01',
    historic_code: 31,
    historic_template: 'DARF Retenção CSLL · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.CSRF_PIS',
    group: 'PAYABLE_PAID',
    label: 'DARF Retenção CSRF — PIS',
    debit_code: '2.1.4.10',
    credit_code: '1.1.1.01',
    historic_code: 32,
    historic_template: 'DARF Retenção PIS · {periodo}',
  },
  {
    event_key: 'PAYABLE_PAID.CSRF_COFINS',
    group: 'PAYABLE_PAID',
    label: 'DARF Retenção CSRF — COFINS',
    debit_code: '2.1.4.11',
    credit_code: '1.1.1.01',
    historic_code: 33,
    historic_template: 'DARF Retenção COFINS · {periodo}',
  },

  // Pernas extras (retenções) usadas no pagamento de PJ
  {
    event_key: 'PAYABLE_PAID.RETENTION_IRRF',
    group: 'PAYABLE_PAID',
    label: 'Retenção IRRF na fonte (perna crédito)',
    description: 'Crédito adicional gerado em pagamento a PJ com retenção IRRF (1,5%).',
    credit_code: '2.1.4.08',
    historic_code: 40,
    historic_template: 'IRRF retido na fonte',
  },
  {
    event_key: 'PAYABLE_PAID.RETENTION_CSLL',
    group: 'PAYABLE_PAID',
    label: 'Retenção CSLL na fonte (perna crédito)',
    description: 'Crédito adicional gerado em pagamento a PJ com retenção CSLL (1%).',
    credit_code: '2.1.4.09',
    historic_code: 41,
    historic_template: 'CSLL retida na fonte',
  },
  {
    event_key: 'PAYABLE_PAID.RETENTION_PIS',
    group: 'PAYABLE_PAID',
    label: 'Retenção PIS na fonte (perna crédito)',
    description: 'Crédito adicional gerado em pagamento a PJ com retenção PIS (0,65%).',
    credit_code: '2.1.4.10',
    historic_code: 42,
    historic_template: 'PIS retido na fonte',
  },
  {
    event_key: 'PAYABLE_PAID.RETENTION_COFINS',
    group: 'PAYABLE_PAID',
    label: 'Retenção COFINS na fonte (perna crédito)',
    description: 'Crédito adicional gerado em pagamento a PJ com retenção COFINS (3%).',
    credit_code: '2.1.4.11',
    historic_code: 43,
    historic_template: 'COFINS retido na fonte',
  },

  // Conta bancária para pagamentos (override por tipo de banco)
  {
    event_key: 'BANK.MOVIMENTO',
    group: 'BANK',
    label: 'Conta bancária — Movimento',
    description: 'Conta-corrente principal usada como contrapartida em pagamentos/recebimentos.',
    credit_code: '1.1.1.01',
    debit_code: '1.1.1.01',
    historic_template: 'Banco Conta Movimento',
  },
  {
    event_key: 'BANK.PSP_GATEWAY',
    group: 'BANK',
    label: 'Conta bancária — PSP/Gateway',
    description: 'Contrapartida bancária quando a operação passa por gateway de pagamento.',
    credit_code: '1.1.1.03',
    debit_code: '1.1.1.03',
    historic_template: 'PSP/Gateway',
  },

  // ===== Receivables (Emissão e Recebimento) =====
  {
    event_key: 'RECEIVABLE_ISSUED.BASE_DEBIT',
    group: 'RECEIVABLE',
    label: 'Emissão de recebível — débito Clientes',
    description: 'Conta de débito (Clientes/Recebíveis) em todo recebível emitido.',
    debit_code: '1.1.2.01',
    historic_code: 50,
    historic_template: 'Faturamento · {cliente}',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_OPERATIONAL',
    group: 'RECEIVABLE',
    label: 'Receita Operacional (GGR)',
    credit_code: '4.1.1.01',
    historic_code: 51,
    historic_template: 'Receita operacional',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_FINANCEIRA_JUROS',
    group: 'RECEIVABLE',
    label: 'Receita financeira — Juros',
    credit_code: '4.1.2.01',
    historic_code: 52,
    historic_template: 'Receita de juros',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_FINANCEIRA_OUTRAS',
    group: 'RECEIVABLE',
    label: 'Receita financeira — Outras',
    credit_code: '4.1.2.02',
    historic_code: 53,
    historic_template: 'Receita financeira',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_ROYALTIES',
    group: 'RECEIVABLE',
    label: 'Receita de Royalties',
    credit_code: '4.2.02',
    historic_code: 54,
    historic_template: 'Royalties',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_RECUPERACAO_TRIB',
    group: 'RECEIVABLE',
    label: 'Recuperação tributária',
    credit_code: '4.2.01',
    historic_code: 55,
    historic_template: 'Recuperação tributária',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_REEMBOLSOS',
    group: 'RECEIVABLE',
    label: 'Reembolsos',
    credit_code: '4.2.03',
    historic_code: 56,
    historic_template: 'Reembolso',
  },
  {
    event_key: 'RECEIVABLE_ISSUED.REVENUE_OUTROS',
    group: 'RECEIVABLE',
    label: 'Outras receitas não-operacionais',
    credit_code: '4.2.99',
    historic_code: 57,
    historic_template: 'Outras receitas',
  },
  {
    event_key: 'RECEIVABLE_RECEIVED.BASE_CREDIT',
    group: 'RECEIVABLE',
    label: 'Recebimento — crédito Clientes',
    description: 'Conta de crédito (Clientes/Recebíveis) na baixa do recebível.',
    credit_code: '1.1.2.01',
    historic_code: 58,
    historic_template: 'Recebimento · {cliente}',
  },

  // ===== Apuração de tributos (provisões) =====
  {
    event_key: 'TAX_CLOSE.IRPJ',
    group: 'TAX_APURATION',
    label: 'Provisão IRPJ (fechamento)',
    debit_code: '5.1.05',
    credit_code: '2.1.4.01',
    historic_code: 70,
    historic_template: 'Provisão IRPJ · {periodo}',
  },
  {
    event_key: 'TAX_CLOSE.CSLL',
    group: 'TAX_APURATION',
    label: 'Provisão CSLL (fechamento)',
    debit_code: '5.1.06',
    credit_code: '2.1.4.02',
    historic_code: 71,
    historic_template: 'Provisão CSLL · {periodo}',
  },
  {
    event_key: 'TAX_CLOSE.PIS',
    group: 'TAX_APURATION',
    label: 'Provisão PIS (fechamento)',
    debit_code: '5.1.02',
    credit_code: '2.1.4.03',
    historic_code: 72,
    historic_template: 'Provisão PIS · {periodo}',
  },
  {
    event_key: 'TAX_CLOSE.COFINS',
    group: 'TAX_APURATION',
    label: 'Provisão COFINS (fechamento)',
    debit_code: '5.1.03',
    credit_code: '2.1.4.04',
    historic_code: 73,
    historic_template: 'Provisão COFINS · {periodo}',
  },
  {
    event_key: 'TAX_CLOSE.ISS',
    group: 'TAX_APURATION',
    label: 'Provisão ISS (fechamento)',
    debit_code: '5.1.04',
    credit_code: '2.1.4.05',
    historic_code: 74,
    historic_template: 'Provisão ISS · {periodo}',
  },
  {
    event_key: 'TAX_CLOSE.LEI14790',
    group: 'TAX_APURATION',
    label: 'Provisão Tributo Lei 14.790',
    debit_code: '5.1.01',
    credit_code: '2.1.4.06',
    historic_code: 75,
    historic_template: 'Provisão Tributo Lei 14.790 · {periodo}',
  },
  {
    event_key: 'TAX_CLOSE.IRRF_PREMIOS',
    group: 'TAX_APURATION',
    label: 'Provisão IRRF sobre prêmios',
    debit_code: '5.1.01',
    credit_code: '2.1.4.07',
    historic_code: 76,
    historic_template: 'Provisão IRRF Prêmios · {periodo}',
  },
];

/**
 * Sincroniza o catálogo default com a tabela accounting_rules.
 * - Cria os event_keys que não existem.
 * - NÃO sobrescreve regras já editadas pelo ADMIN (upsert apenas no create).
 */
export async function syncDefaultAccountingRules(prisma: PrismaClient) {
  let created = 0;
  for (const r of DEFAULT_ACCOUNTING_RULES) {
    const existing = await prisma.accountingRule.findUnique({ where: { event_key: r.event_key } });
    if (existing) continue;
    await prisma.accountingRule.create({
      data: {
        event_key: r.event_key,
        group: r.group,
        label: r.label,
        description: r.description,
        debit_code: r.debit_code,
        credit_code: r.credit_code,
        historic_code: r.historic_code,
        historic_template: r.historic_template,
      },
    });
    created += 1;
  }
  return { created, total_default: DEFAULT_ACCOUNTING_RULES.length };
}
