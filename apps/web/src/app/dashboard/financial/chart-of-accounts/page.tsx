'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Edit2, Trash2, Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ChartOfAccount, Company, AccountType } from '@/lib/types';
import { accountTypeLabels } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';

function ChartOfAccountForm({ initial, onSubmit, onCancel, current, companies, onApplyTemplate }: { initial?: Partial<ChartOfAccount>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[]; onApplyTemplate?: (companyId: string) => Promise<void> }) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    type: (initial?.type ?? 'EXPENSE') as AccountType,
    description: initial?.description ?? '',
    parent_id: initial?.parent_id ?? '',
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
  });
  const [parents, setParents] = useState<ChartOfAccount[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [accountCount, setAccountCount] = useState<number | null>(null);

  useEffect(() => {
    if (data.company_id) {
      api.get('/financial/chart-of-accounts', { params: { company_id: data.company_id } })
        .then(r => {
          setParents(r.data.data.filter((p: ChartOfAccount) => p.id !== initial?.id));
          setAccountCount(r.data.total ?? r.data.data.length);
        })
        .catch(() => {});
    } else {
      setAccountCount(null);
    }
  }, [data.company_id, initial?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!isEdit && !data.code.trim()) errs.code = 'Código obrigatório';
    if (!isEdit && !/^[\d.]+$/.test(data.code)) errs.code = 'Use apenas números e pontos (ex: 1.1.01)';
    if (!data.name.trim()) errs.name = 'Nome obrigatório';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = { name: data.name };
        if (data.description) payload.description = data.description;
        if (!isEdit) {
          payload.code = data.code;
          payload.type = data.type;
          payload.company_id = data.company_id;
          if (data.parent_id) payload.parent_id = data.parent_id;
        }
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Código" required error={errors.code}>
          <Input value={data.code} onChange={e => setData({ ...data, code: e.target.value })} placeholder="1.1.01" disabled={isEdit} />
        </Field>
        <div className="col-span-2">
          <Field label="Nome" required error={errors.name}>
            <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Ex: Caixa, Receita de Apostas" />
          </Field>
        </div>
      </div>
      <Field label="Tipo" required>
        <Select value={data.type} onChange={e => setData({ ...data, type: e.target.value as AccountType })} disabled={isEdit}>
          <option value="ASSET">Ativo</option>
          <option value="LIABILITY">Passivo</option>
          <option value="EQUITY">Patrimônio Líquido</option>
          <option value="REVENUE">Receita</option>
          <option value="EXPENSE">Despesa</option>
        </Select>
      </Field>
      {!isEdit && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id ?? ''} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      {!isEdit && data.company_id && accountCount === 0 && onApplyTemplate && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-medium text-amber-900 mb-1">Esta empresa não tem plano de contas</div>
            <div className="text-amber-800 mb-2 text-xs">
              Antes de cadastrar contas individualmente, você pode <strong>implantar o Plano Padrão</strong> (670 contas Lei 14.790) e depois ajustar conforme a necessidade.
            </div>
            <button type="button" onClick={async () => { if (data.company_id) await onApplyTemplate(data.company_id); onCancel(); }}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white text-sm rounded-sm hover:bg-amber-700 transition">
              <BookOpen className="w-4 h-4" /> Implantar Plano Padrão
            </button>
          </div>
        </div>
      )}
      {!isEdit && data.company_id && parents.length > 0 && (
        <Field label="Conta pai (opcional)">
          <Select value={data.parent_id ?? ''} onChange={e => setData({ ...data, parent_id: e.target.value })}>
            <option value="">— Nenhuma (conta de primeiro nível) —</option>
            {parents.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Descrição">
        <textarea value={data.description ?? ''} onChange={e => setData({ ...data, description: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={500} />
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar conta'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function ChartOfAccountsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ChartOfAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: ChartOfAccount }>({ type: null });
  const [importOpen, setImportOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const applyTemplate = async (companyId: string) => {
    if (!companyId) { alert('Selecione uma empresa.'); return; }
    if (!confirm('Aplicar o plano modelo? Substitui o plano atual da empresa selecionada.')) return;
    try {
      const r = await api.post(`/financial/chart-of-accounts/apply-template/${companyId}`);
      alert(`✓ ${r.data.total_accounts} contas aplicadas em ${r.data.company}.`);
      setTemplateOpen(false);
      await reload();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao aplicar modelo.');
    }
  };

  const reload = async () => {
    const res = await api.get('/financial/chart-of-accounts', { params: { ...filters, page } });
    setItems(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {}); }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/financial/chart-of-accounts/${modal.data.id}`, data);
    else await api.post('/financial/chart-of-accounts', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    try {
      await api.delete(`/financial/chart-of-accounts/${modal.data.id}`);
      setModal({ type: null }); await reload();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro ao excluir');
    }
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Plano de Contas"
        subtitle="Financeiro · Estrutura contábil"
        action={
          <div className="flex gap-2">
            {user?.profile === 'ADMIN' && (
              <>
                <SecondaryButton onClick={() => setTemplateOpen(true)}>
                  <BookOpen className="w-4 h-4 inline mr-2" /> Plano Padrão
                </SecondaryButton>
                <SecondaryButton onClick={() => setImportOpen(true)}>
                  <Upload className="w-4 h-4 inline mr-2" /> Importar XLSX
                </SecondaryButton>
              </>
            )}
            <NewButton onClick={() => setModal({ type: 'create' })} label="Nova conta" />
          </div>
        }
      />
      <FilterBar
        filters={[
          ...(user?.profile === 'ADMIN' ? [{ key: 'company_id', label: 'Empresa', type: 'select' as const, options: companies.map(c => ({ value: c.id, label: c.name })) }] : []),
          { key: 'code', label: 'Código' },
          { key: 'name', label: 'Nome' },
          { key: 'type', label: 'Tipo', type: 'select', options: Object.entries(accountTypeLabels).map(([v, l]) => ({ value: v, label: l })) },
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Código</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nome</th>
                {user?.profile === 'ADMIN' && (
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Empresa</th>
                )}
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={user?.profile === 'ADMIN' ? 5 : 4} className="text-center py-12 text-stone-500">Nenhuma conta cadastrada.</td></tr>}
              {items.map(c => (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-stone-400" strokeWidth={1.5} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  {user?.profile === 'ADMIN' && (
                    <td className="px-4 py-3 text-stone-600 text-xs">{companies.find(co => co.id === c.company_id)?.name ?? '—'}</td>
                  )}
                  <td className="px-4 py-3 text-stone-700">{accountTypeLabels[c.type]}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setModal({ type: 'edit', data: c })} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setModal({ type: 'delete', data: c })} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      {user && (
        <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Nova conta' : 'Editar conta'} size="lg">
          <ChartOfAccountForm
            initial={modal.data}
            current={user}
            companies={companies}
            onSubmit={handleSave}
            onCancel={() => setModal({ type: null })}
            onApplyTemplate={user.profile === 'ADMIN' ? applyTemplate : undefined}
          />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a conta" />

      <ImportPlanModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        companies={companies}
        onSuccess={async () => { setImportOpen(false); await reload(); }}
      />

      <ApplyTemplateModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        companies={companies}
        onApply={applyTemplate}
      />
    </div>
  );
}

function ApplyTemplateModal({ open, onClose, companies, onApply }: {
  open: boolean; onClose: () => void; companies: Company[];
  onApply: (companyId: string) => Promise<void>;
}) {
  const [companyId, setCompanyId] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Implantar Plano Padrão" size="md">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 text-sm text-blue-900">
          <strong>Plano Padrão Lei 14.790:</strong> 670 contas com todas as sintéticas + analíticas
          padronizadas (PIS, COFINS, ISS, IRPJ, CSLL etc.) e <strong> sem entidades específicas</strong>
          (fornecedores, clientes, bancos individuais, aplicações). Ideal pra empresas novas — as
          subcontas (fornecedor X, banco Y) vão sendo criadas conforme você usa o sistema.
        </div>

        <Field label="Empresa de destino" required>
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value="">— selecione —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
          ⚠ Ao aplicar, o plano atual da empresa selecionada será <strong>substituído</strong>.
          Contas em uso são preservadas no banco (soft-delete) para manter referências históricas.
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
          <SecondaryButton type="button" onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton type="button" onClick={() => onApply(companyId)} disabled={!companyId}>
            <BookOpen className="w-4 h-4 inline mr-2" /> Aplicar Plano Padrão
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function ImportPlanModal({ open, onClose, companies, onSuccess }: {
  open: boolean; onClose: () => void; companies: Company[]; onSuccess: () => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null); setPreview(null); setDone(null);
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setFileBase64(result.split(',')[1] ?? '');
    };
    reader.onerror = () => setError('Erro ao ler arquivo.');
    reader.readAsDataURL(f);
  };

  const runPreview = async () => {
    if (!companyId || !fileBase64) return;
    setBusy('preview'); setError(null); setDone(null);
    try {
      const r = await api.post(`/financial/chart-of-accounts/import/${companyId}`, {
        file_base64: fileBase64, dry_run: true,
      });
      setPreview(r.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err.message);
    } finally { setBusy(null); }
  };

  const runCommit = async () => {
    if (!companyId || !fileBase64) return;
    if (!confirm(`Substituir o plano de contas atual? Todas as contas existentes serão marcadas como excluídas (mantidas no banco para preservar referências históricas).`)) return;
    setBusy('commit'); setError(null);
    try {
      const r = await api.post(`/financial/chart-of-accounts/import/${companyId}`, {
        file_base64: fileBase64, dry_run: false,
      });
      setDone(r.data);
      setTimeout(onSuccess, 1500);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err.message);
    } finally { setBusy(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Importar Plano de Contas" size="lg">
      <div className="space-y-4">
        <Field label="Empresa de destino" required>
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value="">— selecione —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        <Field label="Arquivo (XLS/XLSX exportado da contabilidade)" required>
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-stone-300 rounded-sm hover:bg-stone-100 text-sm">
            <Upload className="w-4 h-4" />
            {fileName || 'Selecionar arquivo'}
            <input type="file" accept=".xls,.xlsx" onChange={handleFile} className="hidden" />
          </label>
          <div className="text-xs text-stone-500 mt-1">
            Formato esperado: planilha "Contas" com colunas Classificação (código hierárquico tipo 1.1.1.01) e Nome.
          </div>
        </Field>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {preview && (
          <div className="bg-blue-50 border border-blue-200 rounded-sm p-4">
            <h4 className="font-medium text-blue-900 mb-2">Preview da importação ({preview.company})</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><strong>{preview.total_accounts}</strong> contas serão importadas</div>
              {preview.orphans > 0 && (
                <div className="text-amber-700">{preview.orphans} órfãs (sem pai no arquivo)</div>
              )}
            </div>
            {preview.by_type && (
              <div className="mt-2 text-xs text-blue-800">
                Por tipo: {Object.entries(preview.by_type).map(([k, v]) => `${k}=${v}`).join(' · ')}
              </div>
            )}
            <div className="mt-2 text-xs text-stone-600">
              Primeira: <code>{preview.sample_first?.[0]?.code} - {preview.sample_first?.[0]?.name}</code>
              <br />
              Última: <code>{preview.sample_last?.[preview.sample_last.length-1]?.code} - {preview.sample_last?.[preview.sample_last.length-1]?.name}</code>
            </div>
          </div>
        )}

        {done && (
          <div className="bg-green-50 border border-green-200 rounded-sm p-4 flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-700 flex-shrink-0" />
            <div className="text-sm text-green-900">
              <strong>{done.total_accounts}</strong> contas importadas para <strong>{done.company}</strong>.
              ({done.created} criadas, {done.updated} atualizadas)
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
          <SecondaryButton type="button" onClick={onClose}>Fechar</SecondaryButton>
          <SecondaryButton type="button" onClick={runPreview} disabled={!companyId || !fileBase64 || busy !== null}>
            {busy === 'preview' ? <Loader2 className="w-4 h-4 inline mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 inline mr-2" />}
            Pré-visualizar
          </SecondaryButton>
          <PrimaryButton type="button" onClick={runCommit} disabled={!preview || busy !== null}>
            {busy === 'commit' ? <Loader2 className="w-4 h-4 inline mr-2 animate-spin" /> : <Upload className="w-4 h-4 inline mr-2" />}
            Importar e substituir
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
