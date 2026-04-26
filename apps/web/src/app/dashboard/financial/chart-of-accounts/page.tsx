'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Edit2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ChartOfAccount, Company, AccountType } from '@/lib/types';
import { accountTypeLabels } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';

function ChartOfAccountForm({ initial, onSubmit, onCancel, current, companies }: { initial?: Partial<ChartOfAccount>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[] }) {
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

  useEffect(() => {
    if (data.company_id) {
      api.get('/financial/chart-of-accounts', { params: { company_id: data.company_id } })
        .then(r => setParents(r.data.data.filter((p: ChartOfAccount) => p.id !== initial?.id)))
        .catch(() => {});
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
      <PageHeader title="Plano de Contas" subtitle="Financeiro · Estrutura contábil" action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova conta" />} />
      <FilterBar
        filters={[
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
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={4} className="text-center py-12 text-stone-500">Nenhuma conta cadastrada.</td></tr>}
              {items.map(c => (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-stone-400" strokeWidth={1.5} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
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
          <ChartOfAccountForm initial={modal.data} current={user} companies={companies} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a conta" />
    </div>
  );
}
