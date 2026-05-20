'use client';

import { useEffect, useState } from 'react';
import { Building2, Edit2, Trash2, Upload, ArrowLeft, Tag, Plus, Briefcase, ShieldCheck, Loader2, FileText, Download, Mail, FileSpreadsheet, Users, BookOpen, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company, Brand } from '@/lib/types';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';

type TaxRegime = 'LUCRO_REAL' | 'LUCRO_PRESUMIDO' | 'SIMPLES_NACIONAL';
const taxRegimeLabels: Record<TaxRegime, string> = {
  LUCRO_REAL: 'Lucro Real',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  SIMPLES_NACIONAL: 'Simples Nacional',
};

const formatCNPJ = (s: string) => {
  const c = s.replace(/\D/g, '').slice(0, 14);
  return c.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
};

const validateImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  if (!file.type.startsWith('image/')) return reject('Apenas imagens são permitidas.');
  if (file.size > 1024 * 1024) return reject('Arquivo muito grande (máx 1MB).');
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      if (img.width > 256 || img.height > 256) return reject('Logomarca não pode exceder 256x256 pixels.');
      resolve(e.target?.result as string);
    };
    img.onerror = () => reject('Imagem inválida.');
    img.src = e.target?.result as string;
  };
  reader.onerror = () => reject('Erro ao ler arquivo.');
  reader.readAsDataURL(file);
});

function CompanyForm({ initial, onSubmit, onCancel }: { initial?: Partial<Company>; onSubmit: (data: any) => Promise<{ id: string } | void>; onCancel: () => void }) {
  const [data, setData] = useState({
    name: initial?.name ?? '', cnpj: initial?.cnpj ? formatCNPJ(initial.cnpj) : '',
    address: initial?.address ?? '', city: initial?.city ?? '', state: initial?.state ?? '',
    logo: initial?.logo ?? '',
    tax_regime: ((initial as any)?.tax_regime ?? 'LUCRO_REAL') as TaxRegime,
    is_office_account: (initial as any)?.is_office_account ?? false,
    chart_strategy: 'TEMPLATE' as 'TEMPLATE' | 'IMPORT' | 'NONE',
    chart_xlsx_base64: null as string | null,
    chart_xlsx_name: '' as string,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoError, setLogoError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [chartProgress, setChartProgress] = useState<string | null>(null);

  const handleChartFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setData(d => ({ ...d, chart_xlsx_base64: result.split(',')[1] ?? '', chart_xlsx_name: f.name }));
    };
    reader.readAsDataURL(f);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLogoError('');
    try {
      const logo = await validateImage(file);
      setData(d => ({ ...d, logo }));
    } catch (err: any) { setLogoError(err); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim()) errs.name = 'Nome obrigatório';
    if (data.cnpj.replace(/\D/g, '').length !== 14) errs.cnpj = 'CNPJ inválido';
    if (!data.city.trim()) errs.city = 'Cidade obrigatória';
    if (data.state.length !== 2) errs.state = 'Estado obrigatório (UF)';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const isEdit = !!initial?.id;
        const payload: any = {
          name: data.name,
          city: data.city,
          state: data.state,
          tax_regime: data.tax_regime,
          address: data.address || undefined,
          logo: data.logo || undefined,
        };
        if (!isEdit) {
          payload.cnpj = data.cnpj;
          if (data.is_office_account) payload.is_office_account = true;
        }
        const saved = await onSubmit(payload);
        // Aplica plano de contas escolhido (só na criação)
        const newId = (saved as any)?.id;
        if (!isEdit && newId) {
          if (data.chart_strategy === 'TEMPLATE' && !data.is_office_account) {
            setChartProgress('Aplicando plano modelo (670 contas)…');
            try {
              await api.post(`/financial/chart-of-accounts/apply-template/${newId}`);
            } catch (err: any) {
              setErrors({ form: 'Empresa salva, mas erro ao aplicar plano modelo: ' + (err?.response?.data?.message ?? err.message) });
            }
          } else if (data.chart_strategy === 'IMPORT' && data.chart_xlsx_base64) {
            setChartProgress('Importando plano de contas do XLSX…');
            try {
              await api.post(`/financial/chart-of-accounts/import/${newId}`, {
                file_base64: data.chart_xlsx_base64,
              });
            } catch (err: any) {
              setErrors({ form: 'Empresa salva, mas erro ao importar XLSX: ' + (err?.response?.data?.message ?? err.message) });
            }
          }
          setChartProgress(null);
        }
        // Fecha o modal só depois de tudo
        if (!errors.form) onCancel();
      }
      catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome da empresa" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="CNPJ" required error={errors.cnpj}>
          <Input value={data.cnpj} disabled={!!initial?.id}
            onChange={e => setData({ ...data, cnpj: formatCNPJ(e.target.value) })}
            placeholder="00.000.000/0000-00" />
          {!!initial?.id && <div className="text-xs text-stone-500 mt-1">CNPJ não pode ser alterado após cadastro.</div>}
        </Field>
        <Field label="Estado" required error={errors.state}>
          <Input value={data.state} onChange={e => setData({ ...data, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="SP" maxLength={2} />
        </Field>
      </div>
      <Field label="Endereço"><Input value={data.address} onChange={e => setData({ ...data, address: e.target.value })} /></Field>
      <Field label="Cidade" required error={errors.city}>
        <Input value={data.city} onChange={e => setData({ ...data, city: e.target.value })} />
      </Field>
      <Field label="Regime tributário" required>
        <Select value={data.tax_regime} onChange={e => setData({ ...data, tax_regime: e.target.value as TaxRegime })}>
          {(['LUCRO_REAL', 'LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL'] as TaxRegime[]).map(r => (
            <option key={r} value={r}>{taxRegimeLabels[r]}</option>
          ))}
        </Select>
        <div className="text-xs text-stone-500 mt-1">
          Operadoras de apostas (Lei 14.790/2023) devem usar Lucro Real. Holdings/sócias podem optar por Presumido.
        </div>
      </Field>

      {!initial?.id && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={data.is_office_account}
              onChange={e => setData({ ...data, is_office_account: e.target.checked })}
              className="mt-1 w-4 h-4 accent-ink" />
            <div>
              <div className="font-medium text-sm flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-amber-700" />
                Esta é a conta do escritório contábil
              </div>
              <div className="text-xs text-stone-600 mt-1">
                Marque apenas se está cadastrando a <strong>Valentim Contabilidade</strong> (ou a empresa contábil que opera o ContBet).
                Permite anexar o certificado A1 do escritório para uso em <em>Procurador eCAC</em> nos clientes.
                Apenas <strong>uma</strong> conta de escritório é permitida por instalação.
              </div>
            </div>
          </label>
        </div>
      )}

      <Field label="Logomarca (máx 256x256, 1MB)">
        <div className="flex items-center gap-4">
          {data.logo && <img src={data.logo} alt="logo" className="w-16 h-16 object-contain border border-stone-300 rounded-sm bg-white" />}
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-stone-300 rounded-sm hover:bg-stone-100 text-sm">
            <Upload className="w-4 h-4" />
            {data.logo ? 'Trocar imagem' : 'Selecionar imagem'}
            <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </label>
        </div>
        {logoError && <div className="text-xs text-red-600 mt-1">{logoError}</div>}
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}

      {/* Plano de contas inicial — só na CRIAÇÃO de empresa cliente */}
      {!initial?.id && !data.is_office_account && (
        <div className="bg-stone-50 border border-stone-200 rounded-sm p-4">
          <h3 className="font-display text-base flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-stone-500" /> Plano de contas inicial
          </h3>
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer p-2 rounded-sm hover:bg-white">
              <input type="radio" name="chart_strategy" value="TEMPLATE"
                checked={data.chart_strategy === 'TEMPLATE'}
                onChange={() => setData({ ...data, chart_strategy: 'TEMPLATE' })}
                className="mt-1 w-4 h-4 accent-ink" />
              <div className="text-sm">
                <div className="font-medium">Aplicar Plano Padrão (recomendado)</div>
                <div className="text-xs text-stone-600">670 contas Lei 14.790 — sintéticas + analíticas padronizadas (PIS, COFINS, ISS, IRPJ, CSLL).</div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer p-2 rounded-sm hover:bg-white">
              <input type="radio" name="chart_strategy" value="IMPORT"
                checked={data.chart_strategy === 'IMPORT'}
                onChange={() => setData({ ...data, chart_strategy: 'IMPORT' })}
                className="mt-1 w-4 h-4 accent-ink" />
              <div className="text-sm flex-1">
                <div className="font-medium">Importar XLSX da contabilidade</div>
                <div className="text-xs text-stone-600 mb-2">Para empresas que já têm plano em uso (formato Domínio etc.).</div>
                {data.chart_strategy === 'IMPORT' && (
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 border border-stone-300 rounded-sm hover:bg-stone-100 text-xs">
                    <Upload className="w-3.5 h-3.5" />
                    {data.chart_xlsx_name || 'Selecionar arquivo (.xls / .xlsx)'}
                    <input type="file" accept=".xls,.xlsx" onChange={handleChartFile} className="hidden" />
                  </label>
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer p-2 rounded-sm hover:bg-white">
              <input type="radio" name="chart_strategy" value="NONE"
                checked={data.chart_strategy === 'NONE'}
                onChange={() => setData({ ...data, chart_strategy: 'NONE' })}
                className="mt-1 w-4 h-4 accent-ink" />
              <div className="text-sm">
                <div className="font-medium">Cadastrar depois</div>
                <div className="text-xs text-stone-600">Empresa salva sem plano. Você pode aplicar depois pelo detalhe da empresa.</div>
              </div>
            </label>
          </div>
          {chartProgress && (
            <div className="mt-3 text-xs text-stone-600 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {chartProgress}
            </div>
          )}
        </div>
      )}

      {/* Marcas vinculadas — sempre exibida (com mensagem na criação) */}
      {initial?.id ? (
        <BrandsSection companyId={initial.id} />
      ) : (
        <div className="bg-stone-50 border border-stone-200 rounded-sm p-4 mt-4">
          <h3 className="font-display text-base flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4 text-stone-500" /> Marcas vinculadas
          </h3>
          <p className="text-xs text-stone-600">
            Salve a empresa primeiro para adicionar as marcas operacionais.
            Após salvar, retorne em <strong>Editar</strong> para gerenciar as marcas.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar empresa'}</PrimaryButton>
      </div>
    </form>
  );
}

// === Form de Marca (simplificado, vinculado a uma empresa fixa) ===
function BrandForm({ initial, companyId, onSubmit, onCancel }: {
  initial?: Partial<Brand>; companyId: string;
  onSubmit: (data: any) => Promise<void>; onCancel: () => void;
}) {
  const [data, setData] = useState({
    name: initial?.name ?? '',
    domain: initial?.domain ?? '',
    description: initial?.description ?? '',
    status: (initial?.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 3) errs.name = 'Nome com mínimo de 3 caracteres';
    if (data.name.length > 80) errs.name = 'Máximo 80 caracteres';
    if (data.domain && !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(data.domain)) errs.domain = 'Domínio inválido (ex: marca.com.br)';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = { name: data.name, status: data.status };
        if (data.domain) payload.domain = data.domain;
        if (data.description) payload.description = data.description;
        if (!initial?.id) payload.company_id = companyId;
        await onSubmit(payload);
      } catch (err: any) {
        setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' });
      } finally { setSubmitting(false); }
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome da marca" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Ex: BetExemplo" />
      </Field>
      <Field label="Domínio" error={errors.domain}>
        <Input value={data.domain ?? ''} onChange={e => setData({ ...data, domain: e.target.value.toLowerCase() })} placeholder="betexemplo.com.br" />
      </Field>
      <Field label="Status">
        <Select value={data.status} onChange={e => setData({ ...data, status: e.target.value as any })}>
          <option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option>
        </Select>
      </Field>
      <Field label="Descrição">
        <textarea value={data.description ?? ''} onChange={e => setData({ ...data, description: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[80px]" maxLength={500} />
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar marca'}</PrimaryButton>
      </div>
    </form>
  );
}

// Helpers caixa postal
const formatYYYYMMDD = (s?: string) => {
  if (!s || s.length !== 8) return '—';
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
};
const formatHHMMSS = (s?: string) => {
  if (!s || s.length !== 6) return '';
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
};

interface CaixaMsg {
  isn: string;
  assuntoModelo: string;
  valorParametroAssunto?: string;
  dataEnvio: string;
  horaEnvio?: string;
  dataLeitura?: string;
  indicadorLeitura: string; // "0" não lida, "1" lida
  relevancia: string; // "1" normal, "2" alta
  descricaoOrigem?: string;
  dataValidade?: string;
  dataCiencia?: string;
}

function CaixaPostalView({ data }: { data: any }) {
  let parsed: any = data?.dados;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { /* keep */ }
  }
  const conteudo = parsed?.conteudo?.[0];
  const messages: CaixaMsg[] = conteudo?.listaMensagens ?? [];
  const total = conteudo?.quantidadeMensagens ?? messages.length;
  const naoLidas = messages.filter(m => m.indicadorLeitura === '0').length;

  if (!messages.length) {
    return <div className="text-sm text-stone-600">Caixa postal vazia.</div>;
  }

  const assuntoFinal = (m: CaixaMsg) => {
    if (!m.valorParametroAssunto) return m.assuntoModelo;
    return m.assuntoModelo.replace(/\+\+VARIAVEL\+\+/g, m.valorParametroAssunto);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">{total} mensagens</span>
        {naoLidas > 0 && (
          <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 text-xs rounded-sm">
            {naoLidas} não lida{naoLidas > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="border border-stone-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600 w-24">Data</th>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Assunto</th>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600 w-40">Origem</th>
              <th className="text-center px-3 py-2 text-xs uppercase tracking-wider text-stone-600 w-20">Status</th>
            </tr>
          </thead>
          <tbody>
            {messages.map(m => (
              <tr key={m.isn} className={`border-b border-stone-100 last:border-0 ${m.indicadorLeitura === '0' ? 'bg-amber-50/50' : ''}`}>
                <td className="px-3 py-2.5 text-stone-600 whitespace-nowrap text-xs font-mono">
                  {formatYYYYMMDD(m.dataEnvio)}
                </td>
                <td className="px-3 py-2.5">
                  <div className={`${m.indicadorLeitura === '0' ? 'font-semibold' : ''}`}>
                    {assuntoFinal(m)}
                  </div>
                  {m.dataValidade && (
                    <div className="text-[10px] text-stone-500 mt-0.5">
                      Validade: {formatYYYYMMDD(m.dataValidade)}
                      {m.relevancia === '2' && (
                        <span className="ml-2 text-red-600 uppercase tracking-wider">⚠ alta</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-stone-600">{m.descricaoOrigem ?? '—'}</td>
                <td className="px-3 py-2.5 text-center">
                  {m.indicadorLeitura === '0' ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" title="Não lida" />
                  ) : (
                    <span className="text-stone-400 text-xs">lida</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// === Seção Plano de Contas no detalhe da Empresa ===
function ChartOfAccountsSection({ company }: { company: Company }) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get('/financial/chart-of-accounts', { params: { company_id: company.id, page: 1 } });
      setCount(r.data.total ?? r.data.data.length);
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [company.id]);

  const applyTemplate = async () => {
    if (!confirm('Aplicar o Plano Padrão (670 contas Lei 14.790)? Substitui o plano atual desta empresa.')) return;
    setApplying(true);
    try {
      const r = await api.post(`/financial/chart-of-accounts/apply-template/${company.id}`);
      alert(`✓ ${r.data.total_accounts} contas aplicadas.`);
      await reload();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao aplicar modelo.');
    } finally { setApplying(false); }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-sm overflow-hidden mt-6">
      <div className="px-5 py-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-display text-lg flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-stone-500" /> Plano de Contas
          {!loading && count != null && (
            <span className="text-sm text-stone-500 font-sans">
              ({count} {count === 1 ? 'conta' : 'contas'})
            </span>
          )}
        </h3>
        <div className="flex gap-2">
          <Link href={`/dashboard/financial/chart-of-accounts?company_id=${company.id}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-sm rounded-sm transition">
            <ExternalLink className="w-3.5 h-3.5" /> Gerenciar
          </Link>
          {count === 0 && (
            <button onClick={applyTemplate} disabled={applying} type="button"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white hover:bg-amber-700 text-sm rounded-sm transition disabled:opacity-50">
              {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
              Implantar Plano Padrão
            </button>
          )}
        </div>
      </div>
      <div className="p-5 text-sm">
        {loading ? (
          <div className="text-stone-500">Carregando…</div>
        ) : count === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 flex items-start gap-3">
            <BookOpen className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-amber-900 mb-1">Empresa sem plano de contas</div>
              <p className="text-amber-800 text-xs">
                Para esta empresa funcionar com lançamentos contábeis (DRE, balancete, contas a pagar/receber),
                ela precisa de um plano de contas. Você pode <strong>implantar o Plano Padrão</strong> (670 contas
                Lei 14.790), <strong>importar XLSX</strong> de um sistema contábil existente, ou cadastrar
                contas manualmente.
              </p>
            </div>
          </div>
        ) : (
          <div className="text-stone-600">
            Plano de contas estruturado com <strong>{count} contas</strong>. Clique em <strong>Gerenciar</strong>
            {' '}pra adicionar/editar contas, importar de XLSX ou aplicar o plano modelo.
          </div>
        )}
      </div>
    </div>
  );
}

// === Seção Receita Federal (Serpro) no detalhe da Empresa ===
function ReceitaFederalSection({ company }: { company: Company }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [jsonResult, setJsonResult] = useState<any>(null);

  // Limpa o blob URL ao desmontar
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const downloadPdf = async (kind: 'sitfis' | 'dctfweb') => {
    setBusy(kind); setError(null); setJsonResult(null);
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
    try {
      const endpoint = kind === 'sitfis'
        ? `/serpro/client/${company.id}/sitfis/pdf`
        : `/serpro/client/${company.id}/dctfweb/pdf`;
      const r = await api.post(endpoint, {}, { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err: any) {
      try {
        const text = await err.response?.data?.text?.();
        const parsed = text ? JSON.parse(text) : null;
        setError(parsed?.message ?? err.message);
      } catch {
        setError(err.message);
      }
    } finally { setBusy(null); }
  };

  const [jsonLabel, setJsonLabel] = useState<string>('');
  const fetchJson = async (label: string, endpoint: string) => {
    setBusy(label); setError(null); setJsonLabel(label);
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
    try {
      const r = await api.get(endpoint);
      setJsonResult(r.data);
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message);
    } finally { setBusy(null); }
  };

  if (company.is_office_account) return null;

  return (
    <div className="bg-white border border-stone-200 rounded-sm overflow-hidden mt-6">
      <div className="px-5 py-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
        <h3 className="font-display text-lg flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-stone-500" /> Dados Receita Federal
          <span className="text-sm text-stone-500 font-sans">via Integra Contador</span>
        </h3>
      </div>
      <div className="p-5">
        <p className="text-xs text-stone-600 mb-4">
          Consulta em nome do escritório (procurador eCAC). Requer sessão ativa em
          <strong> Configurações → Procurador eCAC (Serpro)</strong>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => downloadPdf('sitfis')} disabled={!!busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 hover:bg-ink2 rounded-sm text-sm transition disabled:opacity-50">
            {busy === 'sitfis' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            <span className="text-left">
              <div>Situação Fiscal (PDF)</div>
              <div className="text-[10px] uppercase tracking-wider opacity-60">SITFIS</div>
            </span>
          </button>
          <button onClick={() => fetchJson('caixa-postal', `/serpro/client/${company.id}/caixa-postal`)} disabled={!!busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-stone-100 border border-stone-300 hover:bg-stone-200 rounded-sm text-sm transition disabled:opacity-50">
            {busy === 'caixa-postal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 text-amber-700" />}
            <span className="text-left">
              <div>Caixa Postal eCAC</div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500">Mensagens RFB</div>
            </span>
          </button>
          <button onClick={() => downloadPdf('dctfweb')} disabled={!!busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white hover:bg-emerald-800 rounded-sm text-sm transition disabled:opacity-50">
            {busy === 'dctfweb' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            <span className="text-left">
              <div>DCTFWeb (PDF, mês anterior)</div>
              <div className="text-[10px] uppercase tracking-wider opacity-60">GERAL_MENSAL</div>
            </span>
          </button>
          <button onClick={() => fetchJson('sitfis-json', `/serpro/client/${company.id}/sitfis`)} disabled={!!busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-stone-100 border border-stone-300 hover:bg-stone-200 rounded-sm text-sm transition disabled:opacity-50">
            {busy === 'sitfis-json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4 text-stone-500" />}
            <span className="text-left">
              <div>SITFIS (JSON cru)</div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500">Debug</div>
            </span>
          </button>
        </div>

        {pdfUrl && (
          <a href={pdfUrl}
            download={`receita_${company.name.replace(/[^a-z0-9]/gi, '_')}.pdf`}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 border border-stone-300 hover:bg-stone-100 rounded-sm text-sm transition">
            <Download className="w-4 h-4" /> Baixar PDF
          </a>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">
            {error}
          </div>
        )}
        {pdfUrl && (
          <div className="mt-4">
            <iframe
              src={pdfUrl}
              className="w-full h-[800px] border border-stone-200 rounded-sm bg-stone-50"
              title="SITFIS"
            />
          </div>
        )}
        {jsonResult && jsonLabel === 'caixa-postal' && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Caixa Postal eCAC</div>
            <CaixaPostalView data={jsonResult} />
          </div>
        )}
        {jsonResult && jsonLabel !== 'caixa-postal' && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">{jsonLabel} — resposta</div>
            <pre className="text-xs bg-stone-50 border border-stone-200 p-3 rounded-sm overflow-auto max-h-96">
{JSON.stringify(jsonResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// === Seção de Marcas no detalhe da Empresa ===
function BrandsSection({ companyId }: { companyId: string }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: Brand }>({ type: null });

  const reload = async () => {
    setLoading(true);
    try {
      const res = await api.get('/brands', { params: { company_id: companyId, page: 1 } });
      setBrands((res.data.data || []).filter((b: Brand) => b.company_id === companyId));
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId]);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/brands/${modal.data.id}`, data);
    else await api.post('/brands', data);
    setModal({ type: null });
    await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/brands/${modal.data.id}`);
    setModal({ type: null });
    await reload();
  };

  return (
    <div className="bg-white border border-stone-200 rounded-sm overflow-hidden mt-6">
      <div className="px-5 py-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
        <h3 className="font-display text-lg flex items-center gap-2">
          <Tag className="w-4 h-4 text-stone-500" /> Marcas vinculadas
          <span className="text-sm text-stone-500 font-sans">({brands.length})</span>
        </h3>
        <button type="button" onClick={() => setModal({ type: 'create' })}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-ink text-stone-100 text-xs rounded-sm hover:bg-ink/90 transition">
          <Plus className="w-3.5 h-3.5" /> Nova marca
        </button>
      </div>
      {loading ? (
        <div className="p-8 text-center text-stone-500 text-sm">Carregando…</div>
      ) : brands.length === 0 ? (
        <div className="p-8 text-center">
          <Tag className="w-10 h-10 mx-auto text-stone-300 mb-3" strokeWidth={1.2} />
          <p className="text-sm text-stone-500">Nenhuma marca cadastrada para esta empresa.</p>
          <button type="button" onClick={() => setModal({ type: 'create' })}
            className="mt-3 text-xs text-stone-700 underline hover:text-ink">Adicionar a primeira marca</button>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Marca</th>
              <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Domínio</th>
              <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Status</th>
              <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {brands.map(b => (
              <tr key={b.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                <td className="px-4 py-2.5 font-medium">{b.name}</td>
                <td className="px-4 py-2.5 text-stone-600 text-xs font-mono">{b.domain ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ${b.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                    {b.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => setModal({ type: 'edit', data: b })}
                    className="p-1 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm" title="Editar"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setModal({ type: 'delete', data: b })}
                    className="p-1 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })}
        title={modal.type === 'edit' ? 'Editar marca' : 'Nova marca'} size="md">
        {(modal.type === 'create' || modal.type === 'edit') && (
          <BrandForm initial={modal.data} companyId={companyId} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        )}
      </Modal>
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })}
        onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a marca" />
    </div>
  );
}

export default function CompaniesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [includeOffice, setIncludeOffice] = useState(false);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: Company }>({ type: null });
  const [selected, setSelected] = useState<Company | null>(null);

  const reload = async () => {
    const res = await api.get('/companies', { params: { ...filters, page, include_office: includeOffice ? 'true' : undefined } });
    setCompanies(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page, includeOffice]);

  const handleSave = async (data: any) => {
    let saved: any = null;
    if (modal.data?.id) {
      const r = await api.patch(`/companies/${modal.data.id}`, data);
      saved = r.data;
    } else {
      const r = await api.post('/companies', data);
      saved = r.data;
    }
    // Não fecha o modal aqui; deixa o CompanyForm fechar via onCancel após
    // aplicar o plano de contas inicial. reload() roda no onCancel também.
    return saved;
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/companies/${modal.data.id}`);
    setModal({ type: null }); setSelected(null); await reload();
  };

  if (user?.profile !== 'ADMIN') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Você não tem permissão para acessar este módulo.</div>;
  }

  if (selected) {
    return (
      <div>
        <button onClick={() => setSelected(null)} className="text-sm text-stone-600 hover:text-ink mb-6 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Voltar para listagem
        </button>
        <PageHeader
          title={selected.name}
          subtitle={selected.is_office_account ? 'Conta de escritório · Valentim Contabilidade' : 'Detalhes da empresa'}
          action={selected.is_office_account ? (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 border border-amber-300 text-amber-900 text-xs uppercase tracking-wider rounded-sm">
              <Briefcase className="w-3.5 h-3.5" /> Escritório contábil
            </span>
          ) : undefined}
        />
        <div className="bg-white border border-stone-200 rounded-sm p-8 grid md:grid-cols-3 gap-8">
          <div className="md:col-span-1 flex flex-col items-center">
            {selected.logo ? <img src={selected.logo} alt={selected.name} className="w-32 h-32 object-contain border border-stone-200 rounded-sm bg-stone-50" />
              : <div className="w-32 h-32 bg-stone-100 border border-stone-200 flex items-center justify-center rounded-sm"><Building2 className="w-12 h-12 text-stone-400" strokeWidth={1} /></div>}
          </div>
          <div className="md:col-span-2 space-y-4">
            <div><div className="text-xs uppercase tracking-wider text-stone-500">CNPJ</div><div>{selected.cnpj}</div></div>
            <div><div className="text-xs uppercase tracking-wider text-stone-500">Endereço</div><div>{selected.address || '—'}</div></div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-xs uppercase tracking-wider text-stone-500">Cidade</div><div>{selected.city}</div></div>
              <div><div className="text-xs uppercase tracking-wider text-stone-500">Estado</div><div>{selected.state}</div></div>
            </div>
            <div className="flex gap-2 pt-4 border-t border-stone-200">
              <PrimaryButton onClick={() => setModal({ type: 'edit', data: selected })}><Edit2 className="w-4 h-4" /> Editar</PrimaryButton>
              <SecondaryButton onClick={() => setModal({ type: 'delete', data: selected })} className="!text-red-600 hover:!bg-red-50">
                <Trash2 className="w-4 h-4 inline mr-2" />Excluir
              </SecondaryButton>
            </div>
          </div>
        </div>

        <BrandsSection companyId={selected.id} />
        <ChartOfAccountsSection company={selected} />
        <ReceitaFederalSection company={selected} />

        <Modal open={modal.type === 'edit'} onClose={() => setModal({ type: null })} title="Editar empresa" size="lg">
          {modal.data && <CompanyForm initial={modal.data} onSubmit={handleSave}
            onCancel={async () => { setModal({ type: null }); await reload(); }} />}
        </Modal>
        <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a empresa" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Empresas" subtitle="Cadastro · Operadoras" action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova empresa" />} />
      <FilterBar
        filters={[
          { key: 'name', label: 'Nome', placeholder: 'Buscar por nome...' },
          { key: 'cnpj', label: 'CNPJ', placeholder: '00.000.000...' },
          { key: 'state', label: 'Estado', placeholder: 'UF' },
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="flex items-center gap-2 mb-4 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer text-stone-700">
          <input type="checkbox" checked={includeOffice} onChange={e => setIncludeOffice(e.target.checked)}
            className="w-4 h-4 accent-ink" />
          <Briefcase className="w-3.5 h-3.5 text-amber-700" />
          Mostrar conta do escritório contábil
        </label>
      </div>

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Empresa</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">CNPJ</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Cidade/UF</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && <tr><td colSpan={4} className="text-center py-12 text-stone-500">Nenhuma empresa cadastrada.</td></tr>}
              {companies.map(c => (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => setSelected(c)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {c.logo ? <img src={c.logo} alt="" className="w-8 h-8 object-contain rounded-sm" /> : <Building2 className="w-7 h-7 text-stone-400" strokeWidth={1.5} />}
                      <span className="font-medium">{c.name}</span>
                      {c.is_office_account && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 text-[10px] uppercase tracking-wider rounded-sm">
                          <Briefcase className="w-3 h-3" /> Escritório
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-700 font-mono text-xs">{formatCNPJ(c.cnpj)}</td>
                  <td className="px-4 py-3 text-stone-700">{c.city}/{c.state}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); setModal({ type: 'edit', data: c }); }} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); setModal({ type: 'delete', data: c }); }} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Nova empresa' : 'Editar empresa'} size="lg">
        <CompanyForm initial={modal.data} onSubmit={handleSave}
          onCancel={async () => { setModal({ type: null }); await reload(); }} />
      </Modal>
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a empresa" />
    </div>
  );
}
