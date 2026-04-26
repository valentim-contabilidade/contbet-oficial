// Tipos do módulo de Naturezas Contábeis

export type NatureType = 'RECEITA' | 'DESPESA';

export type DreSection =
  | 'RECEITA_OPERACIONAL'
  | 'RECEITA_FINANCEIRA'
  | 'DEDUCAO_RECEITA'
  | 'CUSTO_OPERACIONAL'
  | 'DESPESA_OPERACIONAL'
  | 'DESPESA_NAO_OPERACIONAL'
  | 'DESPESA_FINANCEIRA'
  | 'IMPOSTO_LUCRO';

export interface FinancialNature {
  id: string;
  name: string;
  type: NatureType;
  dre_section: DreSection;
  dre_order: number;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  accounting_code: string | null;
  company_id: string;
  created_at: string;
  updated_at: string;
}
