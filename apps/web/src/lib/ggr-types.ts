// Tipos do módulo GGR

export type GgrSourceType = 'CSV_UPLOAD' | 'XLSX_UPLOAD' | 'API_REST' | 'MANUAL';
export type GgrApurationStatus = 'OPEN' | 'CLOSED' | 'PAID';

export interface GgrDailyRecord {
  id: string;
  date: string;
  total_bets: string;
  total_prizes: string;
  total_deposits: string;
  total_withdrawals: string;
  bet_count: number;
  prize_count: number;
  deposit_count: number;
  withdrawal_count: number;
  active_players: number;
  ggr: string;
  source_type: GgrSourceType;
  source_reference: string | null;
  notes: string | null;
  imported_at: string;
  brand_id: string;
  brand?: { id: string; name: string };
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface GgrMonthlyApuration {
  id: string;
  year: number;
  month: number;
  total_bets: string;
  total_prizes: string;
  total_deposits: string;
  total_withdrawals: string;
  ggr: string;
  net_revenue: string;
  tax_lei14790_rate: string;
  tax_lei14790_amount: string;
  irrf_threshold_cents: string;
  irrf_rate: string;
  irrf_taxable_base: string;
  irrf_amount: string;
  pis_rate: string;
  pis_amount: string;
  cofins_rate: string;
  cofins_amount: string;
  total_taxes: string;
  status: GgrApurationStatus;
  closed_at: string | null;
  paid_at: string | null;
  notes: string | null;
  brand_id: string;
  brand?: { id: string; name: string };
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface SegregationCheck {
  expected_players_balance: string;
  actual_bank_balance: string;
  divergence: string;
  is_healthy: boolean;
  alert_level: 'OK' | 'WARNING' | 'CRITICAL';
}

export interface MonthlyApurationResponse {
  apuration: GgrMonthlyApuration;
  daily_records: GgrDailyRecord[];
  segregation: SegregationCheck;
}

export interface GgrDashboard {
  year: number;
  month: number;
  current_month: {
    bets: string;
    prizes: string;
    deposits: string;
    withdrawals: string;
    ggr: string;
    taxes: {
      tax_lei14790_amount: string;
      irrf_amount: string;
      pis_amount: string;
      cofins_amount: string;
      total_taxes: string;
    };
  };
  year_to_date: {
    bets: string;
    prizes: string;
    deposits: string;
    withdrawals: string;
    ggr: string;
    taxes: {
      tax_lei14790_amount: string;
      irrf_amount: string;
      pis_amount: string;
      cofins_amount: string;
      total_taxes: string;
    };
  };
  monthly_series: Array<{
    month: number;
    bets: string;
    prizes: string;
    ggr: string;
  }>;
}
