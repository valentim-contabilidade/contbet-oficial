// Tipos do módulo Tributário

export type TaxRegime = 'LUCRO_REAL' | 'LUCRO_PRESUMIDO' | 'SIMPLES_NACIONAL';
export type PisCofinsRegime = 'CUMULATIVO' | 'NAO_CUMULATIVO';
export type IrpjApurationPeriod = 'TRIMESTRAL' | 'ANUAL_ESTIMATIVA';
export type IrpjApurationStatus = 'OPEN' | 'CLOSED' | 'PAID';
export type LalurAdjustmentType = 'ADDITION' | 'EXCLUSION';

export interface CompanyTaxConfig {
  id: string;
  tax_regime: TaxRegime;
  pis_cofins_regime: PisCofinsRegime;
  apuration_period: IrpjApurationPeriod;
  pis_rate: string;
  cofins_rate: string;
  irpj_rate: string;
  irpj_additional_rate: string;
  irpj_additional_threshold_cents: string;
  csll_rate: string;
  presumed_irpj_rate: string;
  presumed_csll_rate: string;
  iss_rate: string;
  iss_calculation_base: 'GGR' | 'NGR';
  notes: string | null;
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface LalurAdjustment {
  id: string;
  type: LalurAdjustmentType;
  description: string;
  amount: string;
  notes: string | null;
  reference_date: string | null;
  apuration_id: string;
  created_at: string;
}

export interface IrpjCsllApuration {
  id: string;
  period_type: IrpjApurationPeriod;
  year: number;
  quarter: number | null;
  month: number | null;

  ggr_revenue: string;
  other_revenue: string;
  total_revenue: string;

  deductible_expenses: string;

  accounting_profit: string;
  total_additions: string;
  total_exclusions: string;
  taxable_profit: string;

  irpj_base_amount: string;
  irpj_additional_amount: string;
  irpj_total: string;
  irpj_rate: string;
  irpj_additional_rate: string;
  irpj_additional_threshold: string;

  csll_amount: string;
  csll_rate: string;

  total_taxes: string;

  status: IrpjApurationStatus;
  closed_at: string | null;
  paid_at: string | null;
  notes: string | null;

  company_id: string;
  company?: { id: string; name: string };

  lalur_adjustments?: LalurAdjustment[];
  generated_payables?: any[];
  _count?: { lalur_adjustments: number };

  created_at: string;
  updated_at: string;
}

export interface CalculateIrpjResponse {
  apuration: IrpjCsllApuration;
  adjustments: LalurAdjustment[];
  breakdown: {
    ggr_revenue: string;
    other_revenue: string;
    payables_count: number;
    ggr_records_count: number;
  };
}
