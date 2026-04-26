// Tipos da DRE Gerencial

export type PeriodType = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface DreLine {
  label: string;
  amount: string;
  amount_previous: string;
  variation_percent: number | null;
  is_negative?: boolean;
  is_total?: boolean;
  level?: number;
}

export interface ExpenseByCategory {
  category_id: string | null;
  category_name: string;
  category_color: string | null;
  amount: string;
  amount_previous: string;
  percent_of_total: number | null;
  variation_percent: number | null;
}

export interface DreIndicators {
  receita_bruta: string;
  receita_liquida: string;
  lucro_bruto: string;
  ebt: string;
  lucro_liquido: string;
  ebitda: string;
  margem_bruta: number | null;
  margem_operacional: number | null;
  margem_liquida: number | null;
  payout_ratio: number | null;
  lucro_liquido_anterior: string;
  variacao_lucro: number | null;
  variacao_receita: number | null;
}

export interface MonthlySeriesPoint {
  year: number;
  month: number;
  label: string;
  revenue: string;
  prizes: string;
  expenses: string;
  profit: string;
}

export interface DreResponse {
  period: {
    type: PeriodType;
    label: string;
    previous_label: string;
    start: string;
    end: string;
  };
  company: { id: string; name: string; cnpj: string };
  lines: DreLine[];
  expenses_by_category: ExpenseByCategory[];
  indicators: DreIndicators;
  monthly_series: MonthlySeriesPoint[];
}
