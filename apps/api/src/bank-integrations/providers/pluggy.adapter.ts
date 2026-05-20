import axios, { AxiosInstance } from 'axios';

/**
 * Adapter para integração com Pluggy (https://pluggy.ai).
 *
 * Documentação: https://docs.pluggy.ai
 *
 * Fluxo:
 *  1. POST /auth          → access token (válido 2h) usando clientId+clientSecret
 *  2. POST /connect_token → connect token (1h) que o frontend usa no widget
 *  3. Widget abre, titular autentica no banco, retorna `itemId`
 *  4. GET /items/{id}     → status do item (UPDATING, UPDATED, LOGIN_ERROR…)
 *  5. GET /accounts?itemId={id}                          → contas do item
 *  6. GET /transactions?accountId={id}&from=&to=         → transações
 *
 * Status do item (Pluggy):
 *   - UPDATED: pronto para consulta
 *   - UPDATING: em sincronização
 *   - WAITING_USER_INPUT: precisa MFA/SMS
 *   - LOGIN_ERROR: credenciais inválidas
 *   - OUTDATED: precisa renovar (consentimento expirou — comum no Open Finance regulado)
 */

export interface BankIntegrationAdapter {
  createConnectToken(input: CreateConnectTokenInput): Promise<{ token: string; expires_at: Date }>;
  getItem(itemId: string): Promise<ItemSnapshot>;
  listAccounts(itemId: string): Promise<AccountSnapshot[]>;
  listTransactions(input: ListTransactionsInput): Promise<TransactionSnapshot[]>;
  /** Força sincronização do item (Pluggy: PATCH /items/{id} com mfa params ou só refresh) */
  refreshItem(itemId: string): Promise<{ ok: boolean }>;
  /** Catálogo de conectores (bancos) suportados, com logo e nome. */
  listConnectors(filters?: ListConnectorsInput): Promise<ConnectorSnapshot[]>;
}

export interface ListConnectorsInput {
  countries?: string[]; // ['BR']
  types?: string[];     // ['PERSONAL_BANK', 'BUSINESS_BANK']
  sandbox?: boolean;
}

export interface ConnectorSnapshot {
  id: number | string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  type: string | null;        // PERSONAL_BANK, BUSINESS_BANK, INVESTMENT, etc.
  country: string | null;     // 'BR', 'AR'…
  has_mfa: boolean;
  is_open_finance: boolean;
  is_sandbox: boolean;
}

export interface CreateConnectTokenInput {
  /** Identificador opcional para o item (vinculado a um cliente final) */
  client_user_id?: string;
  /** Atualizar item existente em vez de criar novo */
  item_id?: string;
}

export interface ItemSnapshot {
  id: string;
  connector_id: number | string;
  connector_name: string | null;
  connector_logo: string | null;
  status: string;
  status_detail: string | null;
  execution_status: string | null;
  last_updated_at: Date | null;
  next_auto_sync_at: Date | null;
  raw: any;
}

export interface AccountSnapshot {
  id: string;
  type: string | null;        // BANK | CREDIT
  subtype: string | null;     // CHECKING_ACCOUNT, SAVINGS_ACCOUNT, CREDIT_CARD
  number: string | null;
  name: string | null;
  owner: string | null;
  bank_data: { transferNumber?: string; closingBalance?: number } | null;
  balance: number | null;     // saldo atual em reais
  currency_code: string | null;
  raw: any;
}

export interface ListTransactionsInput {
  account_id: string;
  from?: Date;
  to?: Date;
  page_size?: number;
}

export interface TransactionSnapshot {
  id: string;
  description: string;
  amount: number;             // negativo = débito; positivo = crédito
  date: Date;
  balance: number | null;
  category: string | null;
  status: 'PENDING' | 'POSTED';
  type: 'CREDIT' | 'DEBIT';
  payment_data: any;
  raw: any;
}

export class PluggyAdapter implements BankIntegrationAdapter {
  private http: AxiosInstance;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: Date | null = null;

  constructor(clientId: string, clientSecret: string, _sandbox = false) {
    // Pluggy não tem sandbox separada por subdomínio: o "ambiente sandbox"
    // é controlado pela conta/credenciais. Mantemos o flag para compatibilidade.
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.http = axios.create({
      baseURL: 'https://api.pluggy.ai',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && this.accessTokenExpiresAt && this.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
      return this.accessToken;
    }
    const res = await this.http.post('/auth', {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });
    const token = res.data?.apiKey || res.data?.access_token;
    if (!token) throw new Error('Pluggy: credenciais inválidas (sem token na resposta).');
    this.accessToken = token;
    // Pluggy: apiKey válida por 2h
    this.accessTokenExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return token;
  }

  private async authedRequest<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts?: { params?: any; data?: any }): Promise<T> {
    const token = await this.ensureAccessToken();
    try {
      const res = await this.http.request<T>({
        method, url, params: opts?.params, data: opts?.data,
        headers: { 'X-API-KEY': token },
      });
      return res.data;
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  async createConnectToken(input: CreateConnectTokenInput): Promise<{ token: string; expires_at: Date }> {
    const data: any = {};
    if (input.client_user_id) data.clientUserId = input.client_user_id;
    if (input.item_id) data.itemId = input.item_id;
    const res = await this.authedRequest<any>('POST', '/connect_token', { data });
    return {
      token: res.accessToken,
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1h
    };
  }

  async getItem(itemId: string): Promise<ItemSnapshot> {
    const res = await this.authedRequest<any>('GET', `/items/${itemId}`);
    return {
      id: res.id,
      connector_id: res.connector?.id ?? res.connectorId,
      connector_name: res.connector?.name ?? null,
      connector_logo: res.connector?.imageUrl ?? null,
      status: res.status,
      status_detail: res.statusDetail ?? null,
      execution_status: res.executionStatus ?? null,
      last_updated_at: res.updatedAt ? new Date(res.updatedAt) : null,
      next_auto_sync_at: res.nextAutoSyncAt ? new Date(res.nextAutoSyncAt) : null,
      raw: res,
    };
  }

  async refreshItem(itemId: string): Promise<{ ok: boolean }> {
    await this.authedRequest('PATCH', `/items/${itemId}`, { data: {} });
    return { ok: true };
  }

  async listConnectors(filters: ListConnectorsInput = {}): Promise<ConnectorSnapshot[]> {
    const params: any = {};
    if (filters.countries?.length) params.countries = filters.countries.join(',');
    if (filters.types?.length) params.types = filters.types.join(',');
    if (filters.sandbox !== undefined) params.sandbox = filters.sandbox ? 'true' : 'false';

    const res = await this.authedRequest<any>('GET', '/connectors', { params });
    const list: any[] = res?.results ?? res ?? [];
    return list.map((c) => ({
      id: c.id,
      name: c.name ?? '',
      logo_url: c.imageUrl ?? null,
      primary_color: c.primaryColor ? `#${String(c.primaryColor).replace(/^#/, '')}` : null,
      type: c.type ?? null,
      country: c.country ?? null,
      has_mfa: !!c.hasMFA,
      is_open_finance: !!c.isOpenFinance,
      is_sandbox: !!c.isSandbox,
    }));
  }

  async listAccounts(itemId: string): Promise<AccountSnapshot[]> {
    const res = await this.authedRequest<any>('GET', '/accounts', { params: { itemId } });
    const list: any[] = res?.results ?? res ?? [];
    return list.map(a => ({
      id: a.id,
      type: a.type ?? null,
      subtype: a.subtype ?? null,
      number: a.number ?? null,
      name: a.name ?? null,
      owner: a.owner ?? null,
      bank_data: a.bankData ?? null,
      balance: typeof a.balance === 'number' ? a.balance : null,
      currency_code: a.currencyCode ?? 'BRL',
      raw: a,
    }));
  }

  async listTransactions(input: ListTransactionsInput): Promise<TransactionSnapshot[]> {
    const params: any = { accountId: input.account_id, pageSize: input.page_size ?? 500 };
    if (input.from) params.from = this.fmtDate(input.from);
    if (input.to) params.to = this.fmtDate(input.to);
    const all: any[] = [];
    let page = 1;
    while (true) {
      params.page = page;
      const res = await this.authedRequest<any>('GET', '/transactions', { params });
      const items: any[] = res?.results ?? [];
      all.push(...items);
      const total = res?.total ?? items.length;
      if (all.length >= total || items.length === 0) break;
      page++;
      if (page > 50) break; // safety
    }
    return all.map(t => ({
      id: t.id,
      description: t.description ?? t.descriptionRaw ?? '',
      amount: t.amount,
      date: new Date(t.date),
      balance: typeof t.balance === 'number' ? t.balance : null,
      category: t.category ?? t.categoryId ?? null,
      status: (t.status === 'POSTED' || t.status === 'POSTED') ? 'POSTED' : 'PENDING',
      type: t.amount >= 0 ? 'CREDIT' : 'DEBIT',
      payment_data: t.paymentData ?? null,
      raw: t,
    }));
  }

  private fmtDate(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  private translateError(err: any): Error {
    if (err.response) {
      const msg = err.response.data?.message || err.response.data?.error || `HTTP ${err.response.status}`;
      return new Error(`Pluggy: ${msg}`);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return new Error('Não foi possível conectar ao Pluggy. Verifique sua internet.');
    }
    return new Error(`Pluggy: ${err.message ?? 'erro desconhecido'}`);
  }
}

export function createBankAdapter(
  type: string,
  clientId: string,
  clientSecret: string,
  sandbox = false,
): BankIntegrationAdapter {
  switch (type) {
    case 'PLUGGY':
      return new PluggyAdapter(clientId, clientSecret, sandbox);
    default:
      throw new Error(`Provedor de integração bancária não suportado: ${type}`);
  }
}
