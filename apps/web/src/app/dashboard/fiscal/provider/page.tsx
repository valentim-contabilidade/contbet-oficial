'use client';

import { useEffect, useState } from 'react';
import { Settings, Save, CheckCircle, AlertTriangle, Info, Wifi, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import type { FiscalProvider, FiscalProviderType } from '@/lib/fiscal-types';
import { fiscalProviderLabels } from '@/lib/fiscal-format';
import { PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function FiscalProviderPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [provider, setProvider] = useState<FiscalProvider | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Form state separado para os campos editáveis
  const [form, setForm] = useState({
    type: 'PLUGNOTAS' as FiscalProviderType,
    api_key: '',
    sandbox_mode: false,
    auto_sync_enabled: true,
    auto_sync_period: 24,
    notes: '',
    issue_codigo_servico: '',
    issue_cnae: '',
    issue_inscricao_municipal: '',
    issue_iss_aliquota: '',
    issue_descricao_template: 'Receita de operação de apostas - {data}',
    issue_tomador_cnpj: '',
    issue_tomador_razao_social: '',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) {
        setCompanyId(user.company_id);
      } else if (r.data.data.length > 0) {
        setCompanyId(r.data.data[0].id);
      }
    });
  }, [user]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    setTestResult(null);
    api.get(`/fiscal/provider/${companyId}`)
      .then(r => {
        const p = r.data;
        setProvider(p);
        if (p) {
          setForm({
            type: p.type,
            api_key: '',
            sandbox_mode: p.sandbox_mode,
            auto_sync_enabled: p.auto_sync_enabled,
            auto_sync_period: p.auto_sync_period,
            notes: p.notes ?? '',
            issue_codigo_servico: (p as any).issue_codigo_servico ?? '',
            issue_cnae: (p as any).issue_cnae ?? '',
            issue_inscricao_municipal: (p as any).issue_inscricao_municipal ?? '',
            issue_iss_aliquota: (p as any).issue_iss_aliquota?.toString() ?? '',
            issue_descricao_template: (p as any).issue_descricao_template ?? 'Receita de operação de apostas - {data}',
            issue_tomador_cnpj: (p as any).issue_tomador_cnpj ?? '',
            issue_tomador_razao_social: (p as any).issue_tomador_razao_social ?? '',
          });
        } else {
          setForm({
            type: 'PLUGNOTAS', api_key: '', sandbox_mode: false,
            auto_sync_enabled: true, auto_sync_period: 24, notes: '',
            issue_codigo_servico: '', issue_cnae: '', issue_inscricao_municipal: '',
            issue_iss_aliquota: '', issue_descricao_template: 'Receita de operação de apostas - {data}',
            issue_tomador_cnpj: '', issue_tomador_razao_social: '',
          });
        }
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  const save = async () => {
    setError('');
    setSavedAt(null);
    setTestResult(null);

    if (!provider && !form.api_key.trim()) {
      setError('Informe a chave API.');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        company_id: companyId,
        type: form.type,
        sandbox_mode: form.sandbox_mode,
        auto_sync_enabled: form.auto_sync_enabled,
        auto_sync_period: Number(form.auto_sync_period),
        notes: form.notes,
        issue_codigo_servico: form.issue_codigo_servico,
        issue_cnae: form.issue_cnae,
        issue_inscricao_municipal: form.issue_inscricao_municipal,
        issue_iss_aliquota: form.issue_iss_aliquota,
        issue_descricao_template: form.issue_descricao_template,
        issue_tomador_cnpj: form.issue_tomador_cnpj,
        issue_tomador_razao_social: form.issue_tomador_razao_social,
      };
      if (form.api_key.trim()) {
        payload.api_key = form.api_key.trim();
      } else if (provider) {
        // Manter chave existente — backend espera api_key obrigatório,
        // mas se não passar nova vamos repassar a antiga via re-upsert
        setError('Cole a chave API novamente para confirmar.');
        setSaving(false);
        return;
      }

      const res = await api.post('/fiscal/provider', payload);
      setProvider(res.data);
      setForm({ ...form, api_key: '' });
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 4000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao salvar.');
    } finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`/fiscal/provider/${companyId}/test`, {});
      setTestResult({ ok: true, message: res.data.message });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.response?.data?.message || 'Erro de conexão' });
    } finally { setTesting(false); }
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Provedor Fiscal" subtitle="Configuração de integração com PlugNotas para baixar notas fiscais automaticamente" />

      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>

      {loading && <div className="text-center text-stone-500 py-8">Carregando...</div>}

      {!loading && companyId && (
        <>
          {/* Status atual */}
          {provider && (
            <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Status atual</div>
                  <h2 className="font-display text-xl">{fiscalProviderLabels[provider.type]} {provider.sandbox_mode && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-sm ml-2">SANDBOX</span>}</h2>
                  <div className="text-sm text-stone-600 mt-1">
                    Chave atual: <code className="font-mono bg-stone-100 px-2 py-0.5 rounded-sm text-xs">{provider.api_key}</code>
                  </div>
                  {provider.last_sync_at && (
                    <div className="text-xs text-stone-500 mt-1">Última sincronização: {new Date(provider.last_sync_at).toLocaleString('pt-BR')}</div>
                  )}
                </div>
                <SecondaryButton onClick={testConnection} disabled={testing}>
                  <Wifi className="w-4 h-4 inline mr-2" /> {testing ? 'Testando...' : 'Testar conexão'}
                </SecondaryButton>
              </div>

              {testResult && (
                <div className={`mt-4 p-3 rounded-sm flex items-start gap-2 ${testResult.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  {testResult.ok ? <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                  <div className="text-sm">{testResult.message}</div>
                </div>
              )}

              {provider.last_error && (
                <div className="mt-4 p-3 rounded-sm bg-red-50 border border-red-200 flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">
                    <strong>Último erro registrado:</strong> {provider.last_error}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Formulário */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <Settings className="w-5 h-5 text-stone-400" />
              <h2 className="font-display text-xl">{provider ? 'Atualizar configuração' : 'Configurar provedor'}</h2>
            </div>

            <div className="space-y-4">
              <Field label="Provedor">
                <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as FiscalProviderType })}>
                  <option value="PLUGNOTAS">PlugNotas (recomendado)</option>
                  <option value="FOCUS_NFE" disabled>Focus NFe (em breve)</option>
                  <option value="NFE_IO" disabled>NFE.io (em breve)</option>
                </Select>
              </Field>

              <Field label="Chave API (X-API-KEY)" required={!provider}>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={form.api_key}
                    onChange={e => setForm({ ...form, api_key: e.target.value })}
                    placeholder={provider ? '••••••••••••••••••• (cole para alterar)' : 'Cole sua chave API aqui'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-ink"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  💡 Encontre sua chave API em <a href="https://app.plugnotas.com.br" target="_blank" rel="noopener" className="text-ink underline inline-flex items-center gap-1">app.plugnotas.com.br <ExternalLink className="w-3 h-3" /></a>
                </div>
              </Field>

              <label className="flex items-start gap-3 p-3 border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
                <input type="checkbox" checked={form.sandbox_mode}
                  onChange={e => setForm({ ...form, sandbox_mode: e.target.checked })} className="mt-1" />
                <div>
                  <div className="text-sm font-medium">Modo sandbox (testes)</div>
                  <div className="text-xs text-stone-600">Ative para testes — não consome créditos da sua conta. Use apenas durante a homologação.</div>
                </div>
              </label>

              <div className="border-t border-stone-200 pt-4 mt-4">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-3">Sincronização automática</div>
                <label className="flex items-start gap-3 p-3 border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
                  <input type="checkbox" checked={form.auto_sync_enabled}
                    onChange={e => setForm({ ...form, auto_sync_enabled: e.target.checked })} className="mt-1" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Sincronizar automaticamente</div>
                    <div className="text-xs text-stone-600">O sistema buscará novas notas no PlugNotas periodicamente em background.</div>
                  </div>
                </label>

                {form.auto_sync_enabled && (
                  <Field label="Frequência (em horas)">
                    <Input type="number" value={form.auto_sync_period}
                      onChange={e => setForm({ ...form, auto_sync_period: parseInt(e.target.value) || 24 })}
                      min="1" max="168" />
                    <div className="text-xs text-stone-500 mt-1">Recomendado: 24h (uma vez por dia). Mínimo: 1h. Máximo: 168h (semanal).</div>
                  </Field>
                )}
              </div>

              <div className="border-t border-stone-200 pt-4 mt-4">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-3">Emissão de NFSe (saída)</div>
                <div className="text-xs text-stone-600 mb-3">
                  Configure abaixo para usar o botão "Emitir NFSe" nos registros diários de GGR.
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Código do serviço" required={false}>
                    <Input value={form.issue_codigo_servico}
                      onChange={e => setForm({ ...form, issue_codigo_servico: e.target.value })}
                      placeholder='Ex.: "17.06" (LC 116/03)' />
                    <div className="text-xs text-stone-500 mt-1">Cada município tem códigos próprios. Confirme com a prefeitura.</div>
                  </Field>
                  <Field label="CNAE">
                    <Input value={form.issue_cnae}
                      onChange={e => setForm({ ...form, issue_cnae: e.target.value })}
                      placeholder='Ex.: "9200302"' />
                  </Field>
                  <Field label="Inscrição Municipal">
                    <Input value={form.issue_inscricao_municipal}
                      onChange={e => setForm({ ...form, issue_inscricao_municipal: e.target.value })} />
                  </Field>
                  <Field label="Alíquota ISS (%)">
                    <Input type="number" step="0.01" value={form.issue_iss_aliquota}
                      onChange={e => setForm({ ...form, issue_iss_aliquota: e.target.value })} placeholder="5,00" />
                  </Field>
                  <Field label="CNPJ tomador (padrão)">
                    <Input value={form.issue_tomador_cnpj}
                      onChange={e => setForm({ ...form, issue_tomador_cnpj: e.target.value })}
                      placeholder="Vazio = própria empresa (auto-emissão)" />
                  </Field>
                  <Field label="Razão social tomador">
                    <Input value={form.issue_tomador_razao_social}
                      onChange={e => setForm({ ...form, issue_tomador_razao_social: e.target.value })} />
                  </Field>
                </div>
                <Field label="Descrição padrão">
                  <Input value={form.issue_descricao_template}
                    onChange={e => setForm({ ...form, issue_descricao_template: e.target.value })}
                    placeholder="Receita de operação de apostas - {data}" />
                  <div className="text-xs text-stone-500 mt-1">
                    Variáveis: <code>{'{data}'}</code> = data do dia, <code>{'{marca}'}</code> = nome da marca.
                  </div>
                </Field>
              </div>

              <Field label="Observações">
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Notas internas sobre esta configuração..."
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
              </Field>

              <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-700 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-800">
                  <strong>Próximos passos após salvar:</strong>
                  <ol className="list-decimal list-inside mt-1 space-y-0.5">
                    <li>Faça upload do certificado A1 da empresa (menu "Certificados A1")</li>
                    <li>Sincronize as notas em "Documentos fiscais"</li>
                    <li>Para Campina Grande: certifique-se de ter solicitado autorização para Webservice na prefeitura</li>
                  </ol>
                </div>
              </div>

              {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

              <div className="flex items-center justify-between pt-4 border-t border-stone-200">
                {savedAt ? (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle className="w-4 h-4" /> Salvo em {savedAt.toLocaleTimeString('pt-BR')}
                  </div>
                ) : <div></div>}
                <PrimaryButton onClick={save} disabled={saving}>
                  {saving ? 'Salvando...' : <><Save className="w-4 h-4 inline mr-2" />{provider ? 'Atualizar configuração' : 'Salvar e ativar'}</>}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
