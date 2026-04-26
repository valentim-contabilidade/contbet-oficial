// Tipos do módulo Fiscal (NFSe / NFe via PlugNotas)

export type FiscalProviderType = 'PLUGNOTAS' | 'FOCUS_NFE' | 'NFE_IO' | 'ARQUIVEI';
export type FiscalDocumentType = 'NFSE' | 'NFE' | 'NFCE' | 'CTE';
export type FiscalDocumentDirection = 'INCOMING' | 'OUTGOING';
export type FiscalDocumentStatus = 'PENDING' | 'AUTHORIZED' | 'CANCELLED' | 'REJECTED' | 'ERROR';
export type FiscalCertificateStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';

export interface FiscalProvider {
  id: string;
  type: FiscalProviderType;
  api_key: string;          // mascarado (••••)
  api_secret: string | null;
  base_url: string | null;
  sandbox_mode: boolean;
  is_active: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  auto_sync_enabled: boolean;
  auto_sync_period: number;
  notes: string | null;
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface FiscalCertificate {
  id: string;
  cnpj: string;
  holder_name: string;
  serial_number: string | null;
  issuer: string | null;
  valid_from: string;
  valid_to: string;
  status: FiscalCertificateStatus;
  last_error: string | null;
  provider_certificate_id: string | null;
  uploaded_to_provider_at: string | null;
  notes: string | null;
  company_id: string;
  provider_id: string;
  created_at: string;
}

export interface FiscalDocument {
  id: string;
  document_type: FiscalDocumentType;
  direction: FiscalDocumentDirection;
  status: FiscalDocumentStatus;

  access_key: string | null;
  document_number: string | null;
  series: string | null;

  issue_date: string;
  authorization_date: string | null;
  cancellation_date: string | null;

  issuer_cnpj: string;
  issuer_name: string;
  issuer_municipality_code: string | null;
  issuer_state: string | null;

  recipient_cnpj: string | null;
  recipient_name: string | null;

  total_amount: string;
  service_amount: string;
  iss_amount: string;
  iss_rate: string | null;
  irrf_amount: string;
  inss_amount: string;
  pis_amount: string;
  cofins_amount: string;
  csll_amount: string;

  description: string | null;
  service_code: string | null;
  cnae: string | null;

  xml_content: string | null;
  pdf_url: string | null;

  matched_payable_id: string | null;
  matched_payable?: { id: string; description: string; amount: string };
  matched_receivable_id: string | null;
  matched_receivable?: { id: string; description: string; amount: string };
  matched_at: string | null;
  match_score: number | null;

  notes: string | null;
  created_at: string;
}

export interface FiscalSyncLog {
  id: string;
  sync_type: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  documents_fetched: number;
  documents_created: number;
  documents_updated: number;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface SyncResult extends FiscalSyncLog {
  message: string;
}
