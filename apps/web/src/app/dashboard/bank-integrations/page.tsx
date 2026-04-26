'use client';

import { useEffect, useState } from 'react';
import { Banknote, Plus, RefreshCw, Trash2, Save, Eye, EyeOff, ExternalLink, AlertTriangle, CheckCircle, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate } from '@/lib/format';
import {
  PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton, ConfirmDeleteModal,
} from '@/components/ui';
import type { Company } from '@/lib/types';

interface IntegrationConfig {
  id: string;
  type: string;
  client_id: string;     // mascarado
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

// ---------- Loader do widget Pluggy ----------
const PLUGGY_SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect/v2.10.0/pluggy-connect.js';
let pluggyScriptPromise: Promise<void> | null = null;

function loadPluggyScript(): Promise<void> {
  if (pluggyScriptPromise) return pluggyScriptPromise;
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).PluggyConnect) return Promise.resolve();
  pluggyScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PLUGGY_SCRIPT_URL;
    s.async = true;
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
    onSuccess: (itemData: any) => {
      opts.onSuccess(itemData?.item?.id ?? itemData?.itemId);
    },
    onError: opts.onError,
    onClose: opts.onClose,
  });
  widget.init();
}

export default function BankIntegrationsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);

  const [form, setForm] = useState({
    client_id: '',
    client_secret: '',
    sandbox_mode: true,
    notes: '',
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
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId]);

  const saveConfig = async () => {
    if (!companyId) return;
    setError(''); setSaving(true);
    try {
      const payload: any = {
        company_id: companyId,
        sandbox_mode: form.sandbox_mode,
        notes: form.notes,
      };
      // Se editando e usuário não digitou nova chave, mantém — mas backend exige.
      if (!config && (!form.client_id || !form.client_secret)) {
        throw new Error('Informe Client ID e Client Secret.');
      }
      if (form.client_id) payload.client_id = form.client_id;
      else if (config) {
        setError('Cole o Client ID novamente para confirmar.'); setSaving(false); return;
      }
      if (form.client_secret) payload.client_secret = form.client_secret;
      else if (config) {
        setError('Cole o Client Secret novamente para confirmar.'); setSaving(false); return;
      }
      const res = await api.post('/bank-integrations/config', payload);
      setConfig(res.data);
      setForm(f => ({ ...f, client_id: '', client_secret: '' }));
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 4000);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Erro ao salvar.');
    } finally { setSaving(false); }
  };

  const connectBank = async (existingItemId?: string) => {
    if (!companyId) return;
    setError('');
    try {
      const res = await api.post('/bank-integrations/connect-token', {
        company_id: companyId,
        item_id: existingItemId,
      });
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

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Integrações Bancárias"
        subtitle="Captura automática de extratos via Open Finance (Pluggy)"
        action={config ? (
          <PrimaryButton onClick={() => connectBank()} disabled={!config}>
            <Plus className="w-4 h-4 inline mr-2" /> Conectar banco
          </PrimaryButton>
        ) : null}
      />

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
          {/* Configuração Pluggy */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <Settings className="w-5 h-5 text-stone-400" />
              <h2 className="font-display text-xl">{config ? 'Atualizar credenciais Pluggy' : 'Configurar Pluggy'}</h2>
              {config && (
                <span className={`text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider ${config.sandbox_mode ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
                  {config.sandbox_mode ? 'Sandbox' : 'Produção'}
                </span>
              )}
            </div>

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
              </a>
              . O Client Secret é criptografado antes de salvar.
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
          </div>

          {/* Conexões */}
          {config && (
            <>
              {connections.length === 0 ? (
                <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
                  <Banknote className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
                  <h3 className="font-display text-xl mb-2">Nenhum banco conectado ainda</h3>
                  <p className="text-stone-600 mb-6">
                    Clique em "Conectar banco" para abrir o widget oficial do Pluggy. O titular da conta autoriza diretamente no app do banco — credenciais nunca passam por nós.
                  </p>
                  <PrimaryButton onClick={() => connectBank()}>
                    <Plus className="w-4 h-4 inline mr-2" /> Conectar primeiro banco
                  </PrimaryButton>
                </div>
              ) : (
                <div className="space-y-3">
                  {connections.map(c => (
                    <div key={c.id} className="bg-white border border-stone-200 rounded-sm p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          {c.institution_logo && <img src={c.institution_logo} alt="" className="w-10 h-10 rounded-sm bg-stone-50 object-contain" />}
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
                          <SecondaryButton onClick={() => syncConnection(c.id)}
                            disabled={syncingId === c.id}>
                            <RefreshCw className={`w-4 h-4 inline mr-2 ${syncingId === c.id ? 'animate-spin' : ''}`} />
                            {syncingId === c.id ? 'Sincronizando…' : 'Sincronizar'}
                          </SecondaryButton>
                          {(c.status === 'OUTDATED' || c.status === 'LOGIN_ERROR' || c.status === 'WAITING_USER_INPUT') && (
                            <SecondaryButton onClick={() => connectBank(c.provider_item_id)}>
                              Reconectar
                            </SecondaryButton>
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
              )}
            </>
          )}

          <ConfirmDeleteModal
            open={!!deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={handleDelete}
            entityName={deleteTarget?.institution_name ?? 'esta conexão'}
            entityLabel="a conexão bancária"
          />
        </>
      )}
    </div>
  );
}
