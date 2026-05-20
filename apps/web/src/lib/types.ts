export type Profile = 'ADMIN' | 'MANAGER' | 'OWNER';

/**
 * Labels visíveis dos perfis. Mapeamento da terminologia interna para a
 * terminologia do negócio:
 *   ADMIN   → Administrador (master ContBet, contador)
 *   MANAGER → Gestor        (CEO/financeiro chefe da empresa cliente)
 *   OWNER   → Operador      (gerente financeiro de marca específica)
 */
export const PROFILE_LABELS: Record<Profile, string> = {
  ADMIN: 'ADMINISTRADOR',
  MANAGER: 'GESTOR',
  OWNER: 'OPERADOR',
};

export const profileLabel = (p: string) => PROFILE_LABELS[p as Profile] ?? p;
export type Status = 'ACTIVE' | 'INACTIVE';

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  profile: Profile;
  status: Status;
  company_id: string | null;
  brand_id: string | null;
  /** Marcas atribuídas (N:N). Vazio em ADMIN/MANAGER. */
  brand_ids?: string[];
  created_at: string;
  updated_at: string;
  metadeleted: boolean;
}

export interface Company {
  id: string;
  name: string;
  cnpj: string;
  address: string | null;
  city: string;
  state: string;
  logo: string | null;
  tax_regime?: 'LUCRO_REAL' | 'LUCRO_PRESUMIDO' | 'SIMPLES_NACIONAL';
  is_office_account?: boolean;
  created_at: string;
  updated_at: string;
  metadeleted: boolean;
}

export interface Brand {
  id: string;
  name: string;
  domain: string | null;
  description: string | null;
  status: Status;
  company_id: string;
  company?: { id: string; name: string };
  created_at: string;
  updated_at: string;
  metadeleted: boolean;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

// =================== FINANCEIRO ===================

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type BankAccountType = 'CHECKING' | 'SAVINGS' | 'PAYMENT' | 'PSP_GATEWAY' | 'CASH';
export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'PARTIAL';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type CategoryType = 'INCOME' | 'EXPENSE';

export interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  description: string | null;
  parent_id: string | null;
  is_active: boolean;
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface FinancialCategory {
  id: string;
  name: string;
  type: CategoryType;
  color: string | null;
  description: string | null;
  is_active: boolean;
  company_id: string;
  default_nature_id?: string | null;
  default_nature?: { id: string; name: string; dre_section: string; type: string } | null;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  name: string;
  type: BankAccountType;
  bank_name: string | null;
  bank_code: string | null;
  bank_id: string | null;
  agency: string | null;
  account_number: string | null;
  initial_balance: string;
  current_balance: string;
  description: string | null;
  is_active: boolean;
  company_id: string;
  bank_connection_id: string | null;
  provider_account_id: string | null;
  bank_connection?: {
    id: string;
    institution_name: string | null;
    institution_logo: string | null;
    status: string;
    last_sync_at: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface AccountPayable {
  id: string;
  description: string;
  supplier_name: string | null;
  supplier_doc: string | null;
  document_number: string | null;
  amount: string;
  paid_amount: string;
  issue_date: string;
  due_date: string;
  payment_date: string | null;
  status: PaymentStatus;
  notes: string | null;
  is_recurring: boolean;
  is_deductible_expense?: boolean;
  generates_pis_cofins_credit?: boolean;
  // Retenções federais (CSRF) — serviços tomados de PJ
  is_service_from_pj?: boolean;
  irrf_retained?: string;
  csll_retained?: string;
  pis_retained?: string;
  cofins_retained?: string;
  company_id: string;
  brand_id: string | null;
  contact_id: string | null;
  category_id: string | null;
  account_id: string | null;
  contact?: { id: string; name: string } | null;
  category?: { id: string; name: string; color: string | null } | null;
  brand?: { id: string; name: string } | null;
  account?: { id: string; code: string; name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface AccountReceivable {
  id: string;
  description: string;
  customer_name: string | null;
  customer_doc: string | null;
  document_number: string | null;
  amount: string;
  received_amount: string;
  issue_date: string;
  due_date: string;
  receipt_date: string | null;
  status: PaymentStatus;
  notes: string | null;
  is_recurring: boolean;
  company_id: string;
  brand_id: string | null;
  contact_id: string | null;
  category_id: string | null;
  account_id: string | null;
  contact?: { id: string; name: string } | null;
  category?: { id: string; name: string; color: string | null } | null;
  brand?: { id: string; name: string } | null;
  account?: { id: string; code: string; name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: string;
  type: TransactionType;
  date: string;
  notes: string | null;
  reference: string | null;
  company_id: string;
  brand_id: string | null;
  bank_account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  account_id: string | null;
  payable_id: string | null;
  receivable_id: string | null;
  bank_account?: { id: string; name: string };
  destination_account?: { id: string; name: string } | null;
  category?: { id: string; name: string; color: string | null } | null;
  brand?: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface FinancialDashboard {
  balance: { total: string; accounts_count: number };
  payable: { pending_total: string; count: number; overdue_total: string; overdue_count: number };
  receivable: { pending_total: string; count: number; overdue_total: string; overdue_count: number };
  month: { income: string; expense: string; net: string; year: number; month: number };
}

export interface CashFlow {
  year: number;
  months: Array<{ month: number; income: string; expense: string; net: string }>;
}

// =================== PESSOAS / CONTATOS ===================

export type ContactPersonType = 'INDIVIDUAL' | 'COMPANY';

export interface Contact {
  id: string;
  person_type: ContactPersonType;
  name: string;
  trade_name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;

  address: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;

  is_customer: boolean;
  is_supplier: boolean;
  is_employee: boolean;
  is_partner: boolean;

  employee_role: string | null;
  employee_salary: string | null;
  employee_admission_date: string | null;
  employee_dismissal_date: string | null;

  partner_share_percentage: string | null;

  notes: string | null;
  is_active: boolean;
  company_id: string;
  created_at: string;
  updated_at: string;
}

// =================== BANCOS ===================

export interface Bank {
  id: string;
  code: string;
  name: string;
  ispb: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// =================== CONCILIAÇÃO ===================

export type StatementStatus = 'PROCESSING' | 'RECONCILED' | 'PARTIAL' | 'UNRECONCILED';
export type StatementLineStatus = 'UNMATCHED' | 'MATCHED' | 'IGNORED' | 'CREATED';
export type StatementLineType = 'CREDIT' | 'DEBIT';

export interface BankStatement {
  id: string;
  filename: string;
  file_format: string;
  start_date: string;
  end_date: string;
  initial_balance: string | null;
  final_balance: string | null;
  status: StatementStatus;
  total_lines: number;
  matched_lines: number;
  notes: string | null;
  bank_account_id: string;
  bank_account?: { id: string; name: string };
  company_id: string;
  created_at: string;
  updated_at: string;
  lines?: BankStatementLine[];
}

export interface BankStatementLine {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: StatementLineType;
  fit_id: string | null;
  reference: string | null;
  status: StatementLineStatus;
  match_score: number | null;
  statement_id: string;
  transaction_id: string | null;
  transaction?: {
    id: string;
    description: string;
    amount: string;
    date: string;
    type: TransactionType;
  } | null;
}
