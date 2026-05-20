'use client';

import { useEffect, useState, useMemo } from 'react';
import { Database, Plus, Edit2, Trash2, Activity, Zap, RefreshCw, CheckCircle2, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDate, todayInput } from '@/lib/format';
import { PageHeader, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';
import type { Company, Brand } from '@/lib/types';

type GgrSourceType = 'CSV_UPLOAD' | 'XLSX_UPLOAD' | 'API_REST' | 'MANUAL';
type DataSourceStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR';

interface DataSource {
  id: string;
  name: string;
  type: GgrSourceType;
  status: DataSourceStatus;
  base_url: string | null;
  auth_type: string | null;
  auth_token: string | null;     // mascarado
  field_mapping: any;
  config: any;
  last_sync_at: string | null;
  last_error: string | null;
  brand: { id: string; name: string };
  company: { id: string; name: string };
  brand_id: string;
  company_id: string;
}

const sourceTypeLabels: Record<GgrSourceType, string> = {
  API_REST: 'API REST (pull)',
  CSV_UPLOAD: 'CSV (upload)',
  XLSX_UPLOAD: 'XLSX (upload)',
  MANUAL: 'Manual',
};

const statusColors: Record<DataSourceStatus, string> = {
  ACTIVE: 'bg-green-50 text-green-800 border-green-200',
  INACTIVE: 'bg-stone-100 text-stone-600 border-stone-300',
  ERROR: 'bg-red-50 text-red-800 border-red-300',
};

function DataSourceForm({ initial, brands, companies, current, onSubmit, onCancel }: {
  initial?: Partial<DataSource>;
  brands: Brand[]; companies: Company[]; current: any;
  onSubmit: (data: any) => Promise<void>; onCancel: () => void;
}) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    name: initial?.name ?? '',
    type: (initial?.type ?? 'API_REST') as GgrSourceType,
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    brand_id: initial?.brand_id ?? '',
    base_url: initial?.base_url ?? '',
    auth_type: initial?.auth_type ?? 'BEARER',
    auth_token: '',
    config: {
      brand_code: initial?.config?.brand_code ?? '',
      date_param_name: initial?.config?.date_param_name ?? 'date',
      brand_param_name: initial?.config?.brand_param_name ?? 'brand_code',
    },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const visibleBrands = brands.filter(b => b.company_id === data.company_id);
  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim()) errs.name = 'Nome obrigatório';
    if (!data.company_id) errs.company_id = 'Empresa obrigatória';
    if (!data.brand_id) errs.brand_id = 'Marca obrigatória';
    if (data.type === 'API_REST' && !data.base_url) errs.base_url = 'URL obrigatória para API REST';
    if (data.type === 'API_REST' && !isEdit && !data.auth_token) errs.auth_token = 'Token obrigatório para API REST';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const payload: any = {
        name: data.name,
        type: data.type,
        brand_id: data.brand_id,
      };
      if (!isEdit) payload.company_id = data.company_id;
      if (data.type === 'API_REST') {
        payload.base_url = data.base_url;
        payload.auth_type = data.auth_type;
        if (data.auth_token) payload.auth_token = data.auth_token;
        payload.config = data.config;
      }
      await onSubmit(payload);
    } catch (err: any) {
      setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' });
    } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome da fonte" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })}
          placeholder="Ex: API BetReal · GGR Diário" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id} disabled={isEdit || current.profile === 'MANAGER'}
            onChange={e => setData({ ...data, company_id: e.target.value, brand_id: '' })}>
            <option value="">Selecione…</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Marca" required error={errors.brand_id}>
          <Select value={data.brand_id} disabled={!data.company_id || isEdit}
            onChange={e => setData({ ...data, brand_id: e.target.value })}>
            <option value="">{data.company_id ? 'Selecione…' : 'Selecione a empresa primeiro'}</option>
            {visibleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Tipo" required>
        <Select value={data.type} disabled={isEdit}
          onChange={e => setData({ ...data, type: e.target.value as GgrSourceType })}>
          <option value="API_REST">API REST (pull diário automatizado)</option>
          <option value="CSV_UPLOAD">CSV (upload manual)</option>
          <option value="XLSX_UPLOAD">XLSX (upload manual)</option>
          <option value="MANUAL">Manual (entrada via formulário)</option>
        </Select>
      </Field>

      {data.type === 'API_REST' && (
        <div className="bg-stone-50 border border-stone-200 rounded-sm p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-stone-700 font-medium">Configuração da API externa</div>

          <Field label="URL base do endpoint" required error={errors.base_url}>
            <Input value={data.base_url} onChange={e => setData({ ...data, base_url: e.target.value })}
              placeholder="https://api.suacasa.com.br/api/v1/contbet/totalizadores-diarios" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de autenticação">
              <Select value={data.auth_type} onChange={e => setData({ ...data, auth_type: e.target.value })}>
                <option value="BEARER">Bearer Token</option>
                <option value="API_KEY">API Key (header x-api-key)</option>
                <option value="BASIC">Basic Auth</option>
              </Select>
            </Field>
            <Field label={`Token de leitura ${isEdit ? '(deixe vazio para manter o atual)' : ''}`} error={errors.auth_token}>
              <Input value={data.auth_token} onChange={e => setData({ ...data, auth_token: e.target.value })}
                placeholder={isEdit && initial?.auth_token ? initial.auth_token : 'cole o token aqui'} type="password" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Nome do parâmetro de data">
              <Input value={data.config.date_param_name} onChange={e => setData({ ...data, config: { ...data.config, date_param_name: e.target.value } })}
                placeholder="date" />
            </Field>
            <Field label="Nome do parâmetro de marca">
              <Input value={data.config.brand_param_name} onChange={e => setData({ ...data, config: { ...data.config, brand_param_name: e.target.value } })}
                placeholder="brand_code" />
            </Field>
            <Field label="Código da marca (no sistema deles)">
              <Input value={data.config.brand_code} onChange={e => setData({ ...data, config: { ...data.config, brand_code: e.target.value } })}
                placeholder="BETREAL" />
            </Field>
          </div>
          <p className="text-[11px] text-stone-500">
            O ContBet vai chamar: <code className="bg-stone-200/60 px-1 rounded-sm">GET {data.base_url || 'sua-url'}?{data.config.date_param_name}=YYYY-MM-DD&amp;{data.config.brand_param_name}={data.config.brand_code || 'CODIGO'}</code>
          </p>
        </div>
      )}

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando…' : 'Salvar fonte'}</PrimaryButton>
      </div>
    </form>
  );
}

function TestModal({ source, onClose }: { source: DataSource; onClose: () => void }) {
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    api.post(`/data-sources/${source.id}/test`)
      .then(r => setResult(r.data))
      .catch(err => setResult({ ok: false, error: err.response?.data?.message ?? err.message }))
      .finally(() => setRunning(false));
  }, [source.id]);

  return (
    <div className="space-y-3">
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm">
        <div className="font-medium">{source.name}</div>
        <div className="text-xs text-stone-600 font-mono mt-1 break-all">{source.base_url}</div>
      </div>
      {running ? (
        <div className="text-center py-8 text-stone-500"><RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2" />Testando conexão…</div>
      ) : result?.ok ? (
        <div className="bg-green-50 border border-green-300 rounded-sm p-4">
          <div className="flex items-center gap-2 text-green-800 font-medium mb-2">
            <CheckCircle2 className="w-5 h-5" /> Conexão OK · HTTP {result.http_status}
          </div>
          <div className="text-xs text-stone-700">Data testada: {result.date_tested}</div>
          {result.sample_keys?.length > 0 && (
            <div className="mt-2 text-xs">
              <span className="text-stone-600">Campos detectados:</span>
              <div className="font-mono text-[10px] mt-1 text-stone-700 bg-white border border-stone-200 rounded-sm p-2">
                {result.sample_keys.join(', ')}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-red-50 border border-red-300 rounded-sm p-4">
          <div className="flex items-center gap-2 text-red-800 font-medium mb-2">
            <AlertTriangle className="w-5 h-5" /> Falha na conexão
            {result?.http_status && <span className="text-xs ml-1">HTTP {result.http_status}</span>}
          </div>
          <div className="text-xs text-stone-700 mb-1">{result?.error}</div>
          {result?.details && (
            <pre className="text-[10px] bg-white border border-red-200 rounded-sm p-2 overflow-auto max-h-40">{JSON.stringify(result.details, null, 2)}</pre>
          )}
        </div>
      )}
      <div className="flex justify-end pt-3 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onClose}>Fechar</SecondaryButton>
      </div>
    </div>
  );
}

function SyncModal({ source, onSynced, onClose }: { source: DataSource; onSynced: () => void; onClose: () => void }) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const [startDate, setStartDate] = useState(yesterday.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(yesterday.toISOString().slice(0, 10));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const submit = async () => {
    setRunning(true);
    try {
      const r = await api.post(`/data-sources/${source.id}/sync`, { start_date: startDate, end_date: endDate });
      setResult(r.data);
      onSynced();
    } catch (err: any) {
      setResult({ error: err.response?.data?.message ?? err.message });
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm">
        <div className="font-medium">{source.name}</div>
        <div className="text-xs text-stone-600">Marca: {source.brand.name}</div>
      </div>
      {!result && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="De" required>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </Field>
            <Field label="Até" required>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-stone-500">
            O ContBet fará uma chamada GET por dia no intervalo, populando os registros diários da marca.
          </p>
          <div className="flex justify-end gap-3 pt-3 border-t border-stone-200">
            <SecondaryButton type="button" onClick={onClose} disabled={running}>Cancelar</SecondaryButton>
            <PrimaryButton type="button" onClick={submit} disabled={running}>
              {running ? 'Sincronizando…' : <><Zap className="w-4 h-4 inline mr-1" /> Sincronizar agora</>}
            </PrimaryButton>
          </div>
        </>
      )}
      {result && !result.error && (
        <>
          <div className="bg-green-50 border border-green-300 rounded-sm p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-800 font-medium">
              <CheckCircle2 className="w-5 h-5" /> Sincronização concluída
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm text-stone-700">
              <div>✓ Sincronizados: <strong>{result.synced}</strong></div>
              <div>– Sem dados: <strong>{result.skipped}</strong></div>
              <div className={result.errors?.length > 0 ? 'text-red-700' : ''}>! Erros: <strong>{result.errors?.length ?? 0}</strong></div>
            </div>
            {result.errors?.length > 0 && (
              <div className="text-xs mt-2">
                <div className="text-stone-600">Erros:</div>
                <ul className="mt-1 space-y-1">
                  {result.errors.slice(0, 5).map((e: any, i: number) => (
                    <li key={i} className="text-red-700 font-mono text-[10px]">{e.date}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex justify-end pt-3 border-t border-stone-200">
            <SecondaryButton type="button" onClick={onClose}>Fechar</SecondaryButton>
          </div>
        </>
      )}
      {result?.error && (
        <>
          <div className="bg-red-50 border border-red-300 rounded-sm p-4 text-red-800">
            <AlertTriangle className="w-5 h-5 inline mr-2" />{result.error}
          </div>
          <div className="flex justify-end pt-3 border-t border-stone-200">
            <SecondaryButton type="button" onClick={onClose}>Fechar</SecondaryButton>
          </div>
        </>
      )}
    </div>
  );
}

export default function DataSourcesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<DataSource[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | 'test' | 'sync' | null; data?: DataSource }>({ type: null });

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get('/data-sources');
      setItems(r.data.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    reload();
    api.get('/companies').then(r => setCompanies(r.data.data || []));
    api.get('/brands').then(r => setBrands(r.data.data || []));
  }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/data-sources/${modal.data.id}`, data);
    else await api.post('/data-sources', data);
    setModal({ type: null }); await reload();
  };
  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/data-sources/${modal.data.id}`);
    setModal({ type: null }); await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Fontes de dados"
        subtitle="Integrações automatizadas com a plataforma das casas de apostas (pull diário via API REST)"
        action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova fonte" />}
      />

      <div className="bg-stone-50 border border-stone-200 rounded-sm p-4 mb-6 text-xs text-stone-700 flex items-start gap-2">
        <Database className="w-4 h-4 mt-0.5 text-stone-500 flex-shrink-0" />
        <div>
          <strong>Como funciona:</strong> o ContBet executa um GET diário (04:00 BRT) na URL configurada e popula
          automaticamente os registros diários da marca. A casa de apostas <strong>não acessa o ContBet</strong> —
          apenas expõe o endpoint dela. Para a especificação técnica, consulte <code className="bg-stone-200 px-1 rounded">docs/contbet-integration-spec.md</code>.
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center text-stone-500">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Database className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhuma fonte configurada</h3>
          <p className="text-stone-600 text-sm mb-4">Cadastre uma fonte de dados para começar a sincronização automática diária.</p>
          <PrimaryButton onClick={() => setModal({ type: 'create' })}><Plus className="w-4 h-4 inline mr-1" /> Nova fonte</PrimaryButton>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nome</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Marca · Empresa</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Última sync</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.name}</div>
                    {d.base_url && <div className="text-[10px] text-stone-500 font-mono truncate max-w-md">{d.base_url}</div>}
                    {d.last_error && <div className="text-[10px] text-red-700 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{d.last_error}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{d.brand.name}</div>
                    {user?.profile === 'ADMIN' && <div className="text-stone-500">{d.company.name}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ${d.type === 'API_REST' ? 'bg-sky-50 text-sky-800 border border-sky-200' : 'bg-stone-100 text-stone-600 border border-stone-200'}`}>
                      {sourceTypeLabels[d.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-700">
                    {d.last_sync_at ? (
                      <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(d.last_sync_at).toLocaleString('pt-BR')}</div>
                    ) : <span className="text-stone-400 italic">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border ${statusColors[d.status]}`}>
                      {d.status === 'ACTIVE' ? 'Ativa' : d.status === 'INACTIVE' ? 'Inativa' : 'Erro'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {d.type === 'API_REST' && (
                      <>
                        <button onClick={() => setModal({ type: 'test', data: d })}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-sm mr-1" title="Testar conexão">
                          <Activity className="w-3.5 h-3.5" /> Testar
                        </button>
                        <button onClick={() => setModal({ type: 'sync', data: d })}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-sm mr-1" title="Sincronizar manualmente">
                          <Zap className="w-3.5 h-3.5" /> Sincronizar
                        </button>
                      </>
                    )}
                    <button onClick={() => setModal({ type: 'edit', data: d })}
                      className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm" title="Editar"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setModal({ type: 'delete', data: d })}
                      className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })}
        title={modal.type === 'edit' ? 'Editar fonte de dados' : 'Nova fonte de dados'} size="lg">
        {(modal.type === 'create' || modal.type === 'edit') && (
          <DataSourceForm initial={modal.data} brands={brands} companies={companies} current={user}
            onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        )}
      </Modal>
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })}
        onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a fonte de dados" />
      <Modal open={modal.type === 'test'} onClose={() => setModal({ type: null })} title="Testar conexão" size="md">
        {modal.type === 'test' && modal.data && <TestModal source={modal.data} onClose={() => setModal({ type: null })} />}
      </Modal>
      <Modal open={modal.type === 'sync'} onClose={() => setModal({ type: null })} title="Sincronização manual" size="md">
        {modal.type === 'sync' && modal.data && <SyncModal source={modal.data} onSynced={reload} onClose={() => setModal({ type: null })} />}
      </Modal>
    </div>
  );
}
