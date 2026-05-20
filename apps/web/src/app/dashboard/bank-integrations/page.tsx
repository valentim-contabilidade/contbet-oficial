'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, Plus, RefreshCw, Trash2, Save, Eye, EyeOff, ExternalLink, AlertTriangle,
  CheckCircle, Settings, Link2, Upload, ShieldCheck, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate } from '@/lib/format';
import {
  PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton, ConfirmDeleteModal, Modal,
} from '@/components/ui';
import type { Company } from '@/lib/types';

interface IntegrationConfig {
  id: string;
  type: string;
  client_id: string;
  sandbox_mode: boolean;
  is_active: boolean;
  last_error: string | null;
  notes: string | null;
}

interface BankAccountSummary {
  id: string;
  name: string;
  current_balance: string;
  provider_account_id: string | null;
}

interface Connection {
  id: string;
  provider_item_id: string;
  provider_connector_id: string | null;
  institution_name: string | null;
  institution_logo: string | null;
  status: string;
  status_detail: string | null;
  last_sync_at: string | null;
  next_auto_sync_at: string | null;
  last_error: string | null;
  bank_accounts: BankAccountSummary[];
  created_at: string;
}

interface Connector {
  id: number | string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  type: string | null;
  country: string | null;
  has_mfa: boolean;
  is_open_finance: boolean;
  is_sandbox: boolean;
}

interface BankAccountOption { id: string; name: string; bank_name?: string | null }

const statusLabels: Record<string, string> = {
  ACTIVE: 'Atualizada',
  UPDATING: 'Atualizando…',
  WAITING_USER_INPUT: 'Aguardando MFA',
  LOGIN_ERROR: 'Erro de login',
  OUTDATED: 'Consentimento expirado',
  DISCONNECTED: 'Desconectada',
  ERROR: 'Erro',
};
const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-800 border border-green-200',
  UPDATING: 'bg-blue-50 text-blue-800 border border-blue-200',
  WAITING_USER_INPUT: 'bg-amber-50 text-amber-800 border border-amber-200',
  LOGIN_ERROR: 'bg-red-50 text-red-800 border border-red-200',
  OUTDATED: 'bg-amber-50 text-amber-800 border border-amber-200',
  DISCONNECTED: 'bg-stone-100 text-stone-600 border border-stone-300',
  ERROR: 'bg-red-50 text-red-800 border border-red-200',
};

// ---------- Pluggy widget loader ----------
const PLUGGY_SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect/v2.10.0/pluggy-connect.js';
let pluggyScriptPromise: Promise<void> | null = null;
function loadPluggyScript(): Promise<void> {
  if (pluggyScriptPromise) return pluggyScriptPromise;
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).PluggyConnect) return Promise.resolve();
  pluggyScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PLUGGY_SCRIPT_URL; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar o widget Pluggy.'));
    document.body.appendChild(s);
  });
  return pluggyScriptPromise;
}

async function openPluggyConnect(token: string, opts: {
  onSuccess: (itemId: string) => void;
  onClose?: () => void;
  onError?: (e: any) => void;
  itemId?: string;
}) {
  await loadPluggyScript();
  const PluggyConnect = (window as any).PluggyConnect;
  if (!PluggyConnect) throw new Error('PluggyConnect não disponível.');
  const widget = new PluggyConnect({
    connectToken: token,
    includeSandbox: true,
    updateItem: opts.itemId,
    onSuccess: (data: any) => opts.onSuccess(data?.item?.id ?? data?.itemId),
    onError: opts.onError,
    onClose: opts.onClose,
  });
  widget.init();
}

// ---------- Manual import modal ----------
function ManualImportModal({ companyId, onClose, onImported }: {
  companyId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    api.get('/financial/bank-accounts', { params: { company_id: companyId, page: 1 } })
      .then(r => setAccounts(r.data.data || []))
      .catch(() => setAccounts([]));
  }, [companyId]);

  const submit = async () => {
    setError(''); setResult(null);
    if (!accountId) { setError('Selecione a conta bancária.'); return; }
    if (!file) { setError('Escolha o arquivo OFX ou CSV.'); return; }
    setSubmitting(true);
    try {
      const content = await file.text();
      const res = await api.post('/financial/bank-statements/import', {
        bank_account_id: accountId,
        filename: file.name,
        content,
      });
      setResult(res.data);
      onImported();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Erro ao importar.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-xs text-blue-800">
        💡 Importe o extrato em <strong>OFX</strong> (formato padrão dos bancos) ou <strong>CSV</strong>.
        O sistema tenta conciliar automaticamente com transações cadastradas (mesmo valor, ±3 dias).
      </div>

      <Field label="Conta bancária de destino" required>
        <Select value={accountId} onChange={e => setAccountId(e.target.value)}>
          <option value="">Selecione…</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}
            </option>
          ))}
        </Select>
        {accounts.length === 0 && (
          <div className="text-xs text-amber-700 mt-1">
            Nenhuma conta bancária cadastrada. Cadastre em "Contas Bancárias" antes.
          </div>
        )}
      </Field>

      <Field label="Arquivo (OFX / CSV)" required>
        <input type="file" accept=".ofx,.csv,.txt"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm" />
      </Field>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-sm p-3 text-sm text-green-900">
          ✓ Extrato importado: <strong>{result.total_lines ?? result.lines?.length ?? 0}</strong> linha(s)
          {typeof result.matched_lines === 'number' && result.matched_lines > 0 && <> · {result.matched_lines} conciliada(s) automaticamente</>}.
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onClose} disabled={submitting}>Fechar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !accounts.length}>
          {submitting ? 'Importando…' : <><Upload className="w-4 h-4 inline mr-2" /> Importar extrato</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------- Connector logos catalog ----------
function ConnectorsGrid({ connectors }: { connectors: Connector[] }) {
  if (connectors.length === 0) {
    return (
      <div className="text-xs text-stone-500 py-2">
        Lista de bancos será carregada quando você clicar em "Conectar".
      </div>
    );
  }
  // Top 24 mais conhecidos (oculta os outros num "+N")
  const visible = connectors.slice(0, 24);
  const hidden = connectors.length - visible.length;
  return (
    <>
      <div className="grid grid-cols-6 sm:grid-cols-7 md:grid-cols-8 gap-2 mt-3">
        {visible.map(c => (
          <div key={c.id} title={c.name}
            className="aspect-square rounded-sm bg-white border border-stone-200 flex items-center justify-center p-1.5 hover:border-stone-400 transition">
            {c.logo_url
              ? <img src={c.logo_url} alt={c.name} className="max-w-full max-h-full object-contain" />
              : <span className="text-[10px] text-stone-500 text-center leading-tight">{c.name}</span>}
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <div className="text-xs text-stone-500 mt-2">+ {hidden} outros bancos disponíveis no widget</div>
      )}
    </>
  );
}

// ============================================================
// Página principal
// ============================================================
export default function BankIntegrationsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [webhook, setWebhook] = useState<{ url: string; last_webhook_at: string | null } | null>(null);
  const [copiedAt, setCopiedAt] = useState<Date | null>(null);

  const [form, setForm] = useState({
    client_id: '', client_secret: '', sandbox_mode: true, notes: '',
  });
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    });
  }, [user]);

  const reload = async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const [cfgRes, connRes] = await Promise.all([
        api.get(`/bank-integrations/config/${companyId}`).catch(() => ({ data: null })),
        api.get(`/bank-integrations/connections/${companyId}`).catch(() => ({ data: [] })),
      ]);
      setConfig(cfgRes.data);
      setConnections(connRes.data);
      if (cfgRes.data) {
        setForm(f => ({ ...f, client_id: '', client_secret: '', sandbox_mode: cfgRes.data.sandbox_mode, notes: cfgRes.data.notes ?? '' }));
        setShowConfig(false);
        // Catálogo de bancos + webhook URL (best-effort, paralelo)
        api.get(`/bank-integrations/connectors/${companyId}`)
          .then(r => setConnectors(r.data || []))
          .catch(() => setConnectors([]));
        api.get(`/bank-integrations/webhook-config/${companyId}`)
          .then(r => setWebhook(r.data || null))
          .catch(() => setWebhook(null));
      } else {
        setShowConfig(true);
        setConnectors([]);
        setWebhook(null);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId]);

  const saveConfig = async () => {
    if (!companyId) return;
    setError(''); setSaving(true);
    try {
      const payload: any = { company_id: companyId, sandbox_mode: form.sandbox_mode, notes: form.notes };
      if (!config && (!form.client_id || !form.client_secret)) {
        throw new Error('Informe Client ID e Client Secret.');
      }
      if (form.client_id) payload.client_id = form.client_id;
      else if (config) { setError('Cole o Client ID novamente para confirmar.'); setSaving(false); return; }
      if (form.client_secret) payload.client_secret = form.client_secret;
      else if (config) { setError('Cole o Client Secret novamente para confirmar.'); setSaving(false); return; }
      await api.post('/bank-integrations/config', payload);
      setForm(f => ({ ...f, client_id: '', client_secret: '' }));
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 4000);
      await reload();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Erro ao salvar.');
    } finally { setSaving(false); }
  };

  const connectBank = async (existingItemId?: string) => {
    if (!companyId) return;
    setError('');
    try {
      const res = await api.post('/bank-integrations/connect-token', { company_id: companyId, item_id: existingItemId });
      await openPluggyConnect(res.data.token, {
        itemId: existingItemId,
        onSuccess: async (itemId) => {
          if (!itemId) return;
          await api.post('/bank-integrations/connections', { company_id: companyId, item_id: itemId });
          await reload();
        },
        onError: (e: any) => setError(e?.message ?? 'Erro no widget Pluggy.'),
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Erro ao iniciar conexão.');
    }
  };

  const syncConnection = async (id: string) => {
    setSyncingId(id);
    try {
      const res = await api.post(`/bank-integrations/connections/${id}/sync`, {});
      const r = res.data;
      alert(`Sincronizado: ${r.transactions_imported} transação(ões) · ${r.statement_lines_created} novas linhas no extrato.`);
      await reload();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao sincronizar.');
    } finally { setSyncingId(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.delete(`/bank-integrations/connections/${deleteTarget.id}`);
    setDeleteTarget(null);
    await reload();
  };

  const popularConnectors = useMemo(() => {
    const popular = ['itau', 'bradesco', 'banco do brasil', 'caixa', 'santander', 'nubank', 'inter', 'btg', 'c6', 'sicoob', 'sicredi', 'safra', 'banrisul', 'mercado pago', 'pagbank', 'xp', 'bv', 'will', 'original', 'pan', 'next', 'unicred', 'brb', 'banco bs2'];
    const score = (c: Connector) => {
      const n = c.name.toLowerCase();
      const idx = popular.findIndex(p => n.includes(p));
      return idx === -1 ? 999 : idx;
    };
    return [...connectors].sort((a, b) => score(a) - score(b));
  }, [connectors]);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Integrações Bancárias"
        subtitle="Captura automática de extratos via Open Finance ou import manual (OFX/CSV)"
      />

      {/* Empresa */}
      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>

      {loading && <div className="text-center text-stone-500 py-8">Carregando…</div>}

      {!loading && companyId && (
        <>
          {/* ============ DOIS CARDS — Conectada x Manual ============ */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {/* Card Conectada */}
            <div className="bg-blue-50/40 border border-blue-200 rounded-sm overflow-hidden flex flex-col">
              <div className="bg-blue-600 text-white text-[11px] font-medium uppercase tracking-wider px-3 py-1 self-start ml-4 mt-4 rounded-sm">
                Recomendado
              </div>
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-display text-2xl">Conectada</h3>
                  <Link2 className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-sm text-stone-700 mb-2">
                  Conecte sua conta para ter saldo e extrato atualizados <strong>automaticamente</strong>.
                </p>

                <ConnectorsGrid connectors={popularConnectors} />

                <div className="mt-auto pt-4">
                  <button
                    onClick={() => connectBank()}
                    disabled={!config}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm rounded-sm hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    <Plus className="w-4 h-4" /> Conectar
                  </button>
                  {!config && (
                    <div className="text-xs text-amber-800 mt-2 text-center">
                      Configure suas credenciais Pluggy abaixo para habilitar.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Card Manual */}
            <div className="bg-stone-50 border border-stone-200 rounded-sm overflow-hidden flex flex-col">
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-center gap-2 mb-1 mt-7">
                  <h3 className="font-display text-2xl">Manual</h3>
                  <Settings className="w-5 h-5 text-stone-500" />
                </div>
                <p className="text-sm text-stone-700 mb-2">
                  Cadastre as informações de sua conta manualmente.
                </p>
                <p className="text-sm text-stone-700">
                  Nessa modalidade, você é responsável pela <strong>importação dos extratos</strong> (OFX/CSV).
                </p>

                <div className="mt-auto pt-4">
                  <button
                    onClick={() => setImportOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-stone-200 text-ink text-sm rounded-sm hover:bg-stone-300 transition">
                    <Upload className="w-4 h-4" /> Importar extrato OFX/CSV
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Box de segurança */}
          <div className="flex items-start gap-4 mb-8 px-4">
            <div className="bg-blue-100 rounded-sm p-3 flex-shrink-0">
              <ShieldCheck className="w-6 h-6 text-blue-700" strokeWidth={1.5} />
            </div>
            <div className="text-sm text-stone-700">
              <div className="font-medium text-blue-900 mb-1">Seus dados estão seguros</div>
              <p>
                Na conta conectada, o acesso permite <strong>somente leitura e nenhuma ação poderá ser executada</strong>.
                Tudo é realizado por uma operadora regulada (Pluggy / Open Finance) que segue as melhores práticas internacionais de segurança.
                Suas credenciais bancárias <strong>nunca passam pelo ContBet</strong> — você autoriza diretamente no app do seu banco.
              </p>
            </div>
          </div>

          {/* ============ Conexões ativas ============ */}
          {connections.length > 0 && (
            <div className="mb-8">
              <h2 className="font-display text-xl mb-3">Conexões ativas</h2>
              <div className="space-y-3">
                {connections.map(c => (
                  <div key={c.id} className="bg-white border border-stone-200 rounded-sm p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        {c.institution_logo
                          ? <img src={c.institution_logo} alt="" className="w-10 h-10 rounded-sm bg-stone-50 object-contain" />
                          : <div className="w-10 h-10 bg-stone-100 rounded-sm flex items-center justify-center"><Banknote className="w-5 h-5 text-stone-400" /></div>}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-base">{c.institution_name ?? 'Banco'}</h3>
                            <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider ${statusColors[c.status] ?? statusColors.ERROR}`}>
                              {statusLabels[c.status] ?? c.status}
                            </span>
                          </div>
                          <div className="text-xs text-stone-500 mt-0.5">
                            Conectado em {formatDate(c.created_at)}
                            {c.last_sync_at && ` · Último sync: ${new Date(c.last_sync_at).toLocaleString('pt-BR')}`}
                          </div>
                          {c.bank_accounts.length > 0 && (
                            <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
                              {c.bank_accounts.map(a => (
                                <div key={a.id} className="text-xs bg-stone-50 px-2 py-1.5 rounded-sm border border-stone-200 flex items-center justify-between">
                                  <span className="truncate">{a.name}</span>
                                  <span className="font-mono ml-2">{formatBRL(a.current_balance)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {c.last_error && (
                            <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-sm flex items-start gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {c.last_error}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <SecondaryButton onClick={() => syncConnection(c.id)} disabled={syncingId === c.id}>
                          <RefreshCw className={`w-4 h-4 inline mr-2 ${syncingId === c.id ? 'animate-spin' : ''}`} />
                          {syncingId === c.id ? 'Sincronizando…' : 'Sincronizar'}
                        </SecondaryButton>
                        {(c.status === 'OUTDATED' || c.status === 'LOGIN_ERROR' || c.status === 'WAITING_USER_INPUT') && (
                          <SecondaryButton onClick={() => connectBank(c.provider_item_id)}>Reconectar</SecondaryButton>
                        )}
                        <button onClick={() => setDeleteTarget(c)}
                          className="text-xs text-stone-500 hover:text-red-600 inline-flex items-center gap-1 px-2 py-1">
                          <Trash2 className="w-3.5 h-3.5" /> Desconectar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============ Configuração Pluggy (collapsible) ============ */}
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-stone-50 transition">
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-stone-400" />
                <div className="text-left">
                  <div className="font-medium">{config ? 'Credenciais Pluggy configuradas' : 'Configurar credenciais Pluggy'}</div>
                  <div className="text-xs text-stone-500">
                    {config
                      ? <>Client ID: <span className="font-mono">{config.client_id}</span> · Modo {config.sandbox_mode ? 'Sandbox' : 'Produção'}</>
                      : <>Necessário para habilitar a opção "Conectada"</>}
                  </div>
                </div>
              </div>
              {showConfig ? <ChevronUp className="w-5 h-5 text-stone-400" /> : <ChevronDown className="w-5 h-5 text-stone-400" />}
            </button>

            {showConfig && (
              <div className="p-5 border-t border-stone-200">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Client ID" required={!config}>
                    <Input value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}
                      placeholder={config ? `Atual: ${config.client_id} (cole para alterar)` : 'Cole seu Client ID'} />
                  </Field>
                  <Field label="Client Secret" required={!config}>
                    <div className="relative">
                      <Input type={showSecret ? 'text' : 'password'}
                        value={form.client_secret}
                        onChange={e => setForm({ ...form, client_secret: e.target.value })}
                        placeholder={config ? '•••••••••• (cole para alterar)' : 'Cole seu Client Secret'}
                        className="pr-10" />
                      <button type="button" onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-ink">
                        {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </Field>
                </div>

                <label className="flex items-start gap-3 mt-4 p-3 border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
                  <input type="checkbox" checked={form.sandbox_mode}
                    onChange={e => setForm({ ...form, sandbox_mode: e.target.checked })} className="mt-1" />
                  <div>
                    <div className="text-sm font-medium">Modo sandbox (testes)</div>
                    <div className="text-xs text-stone-600">Bancos fictícios — útil para validar a integração sem custo. Desligue ao usar produção.</div>
                  </div>
                </label>

                <Field label="Observações">
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[50px]" maxLength={2000} />
                </Field>

                <div className="text-xs text-stone-500 mt-2">
                  💡 Encontre suas credenciais em{' '}
                  <a href="https://app.pluggy.ai" target="_blank" rel="noopener" className="underline inline-flex items-center gap-1">
                    app.pluggy.ai <ExternalLink className="w-3 h-3" />
                  </a>. O Client Secret é criptografado antes de salvar.
                </div>

                {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm mt-3">{error}</div>}

                <div className="flex items-center justify-between pt-4 border-t border-stone-200 mt-4">
                  {savedAt
                    ? <div className="flex items-center gap-2 text-sm text-green-700"><CheckCircle className="w-4 h-4" /> Salvo em {savedAt.toLocaleTimeString('pt-BR')}</div>
                    : <div></div>}
                  <PrimaryButton onClick={saveConfig} disabled={saving}>
                    {saving ? 'Salvando…' : <><Save className="w-4 h-4 inline mr-2" />{config ? 'Atualizar' : 'Salvar e ativar'}</>}
                  </PrimaryButton>
                </div>

                {/* Webhook: dispara sync automático quando algo muda na Pluggy */}
                {config && webhook && (
                  <div className="mt-6 pt-4 border-t border-stone-200">
                    <div className="text-sm font-medium mb-1">Webhook (sync automático)</div>
                    <div className="text-xs text-stone-600 mb-2">
                      Cole esta URL em <strong>app.pluggy.ai → Applications → Webhooks</strong> para que o ContBet
                      receba updates em tempo real (saldo, novas transações, MFA, expiração de consentimento)
                      sem precisar clicar em "Sincronizar".
                    </div>
                    <div className="flex gap-2 items-center">
                      <Input value={webhook.url} readOnly className="font-mono text-xs" />
                      <SecondaryButton type="button" onClick={() => {
                        navigator.clipboard.writeText(webhook.url);
                        setCopiedAt(new Date());
                        setTimeout(() => setCopiedAt(null), 2500);
                      }}>
                        {copiedAt ? '✓ Copiado' : 'Copiar'}
                      </SecondaryButton>
                    </div>
                    <div className="text-xs text-stone-500 mt-2">
                      {webhook.last_webhook_at
                        ? <>Último webhook recebido: {new Date(webhook.last_webhook_at).toLocaleString('pt-BR')}</>
                        : <>⚠ Nenhum webhook recebido ainda — confira se está configurado no dashboard Pluggy.</>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <ConfirmDeleteModal
            open={!!deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={handleDelete}
            entityName={deleteTarget?.institution_name ?? 'esta conexão'}
            entityLabel="a conexão bancária"
          />

          <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar extrato manualmente" size="md">
            <ManualImportModal
              companyId={companyId}
              onClose={() => setImportOpen(false)}
              onImported={reload}
            />
          </Modal>
        </>
      )}
    </div>
  );
}
