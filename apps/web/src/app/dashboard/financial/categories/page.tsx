'use client';

import { useEffect, useState } from 'react';
import { FolderTree, Edit2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { FinancialCategory, Company, CategoryType } from '@/lib/types';
import { categoryTypeLabels } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';

function CategoryForm({ initial, onSubmit, onCancel, current, companies }: { initial?: Partial<FinancialCategory>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[] }) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    name: initial?.name ?? '',
    type: (initial?.type ?? 'EXPENSE') as CategoryType,
    color: initial?.color ?? '#c9a961',
    description: initial?.description ?? '',
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    default_nature_id: initial?.default_nature_id ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [natures, setNatures] = useState<{ id: string; name: string; dre_section: string; type: string }[]>([]);

  // Carrega naturezas da empresa selecionada (filtra por tipo compatível com categoria)
  useEffect(() => {
    if (!data.company_id) { setNatures([]); return; }
    const expectedNatType = data.type === 'INCOME' ? 'RECEITA' : 'DESPESA';
    api.get('/financial/natures', { params: { company_id: data.company_id, type: expectedNatType, page: 1 } })
      .then(r => setNatures(r.data.data || []))
      .catch(() => setNatures([]));
  }, [data.company_id, data.type]);

  // Se mudou o tipo e a natureza atual já não é compatível, limpa
  useEffect(() => {
    if (!data.default_nature_id) return;
    const found = natures.find(n => n.id === data.default_nature_id);
    if (!found) setData(d => ({ ...d, default_nature_id: '' }));
  }, [natures]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório (mínimo 2 caracteres)';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = { name: data.name, type: data.type, color: data.color };
        if (data.description) payload.description = data.description;
        if (!isEdit) payload.company_id = data.company_id;
        // Sempre envia o campo (mesmo vazio) para permitir limpar o link com Natureza
        payload.default_nature_id = data.default_nature_id || '';
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Ex: Marketing, Tecnologia, Vendas" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo" required>
          <Select value={data.type} onChange={e => setData({ ...data, type: e.target.value as CategoryType })}>
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Receita</option>
          </Select>
        </Field>
        <Field label="Cor">
          <div className="flex items-center gap-2">
            <input type="color" value={data.color} onChange={e => setData({ ...data, color: e.target.value })} className="h-10 w-16 cursor-pointer rounded-sm border border-stone-300" />
            <Input value={data.color} onChange={e => setData({ ...data, color: e.target.value })} placeholder="#c9a961" />
          </div>
        </Field>
      </div>
      {!isEdit && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id ?? ''} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Natureza padrão (DRE)">
        <Select value={data.default_nature_id} onChange={e => setData({ ...data, default_nature_id: e.target.value })} disabled={!data.company_id}>
          <option value="">— sem natureza padrão —</option>
          {natures.map(n => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </Select>
        <p className="text-[11px] text-stone-500 mt-1">
          Define em qual linha da DRE os lançamentos com esta categoria entram.
          Será pré-selecionada automaticamente ao escolher a categoria num pagamento ou recebimento.
        </p>
      </Field>
      <Field label="Descrição">
        <textarea value={data.description ?? ''} onChange={e => setData({ ...data, description: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={300} />
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar categoria'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function CategoriesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<FinancialCategory[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: FinancialCategory }>({ type: null });

  const reload = async () => {
    const res = await api.get('/financial/categories', { params: { ...filters, page } });
    setItems(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {}); }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/financial/categories/${modal.data.id}`, data);
    else await api.post('/financial/categories', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/financial/categories/${modal.data.id}`);
    setModal({ type: null }); await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Você não tem permissão para acessar este módulo.</div>;
  }

  return (
    <div>
      <PageHeader title="Categorias Financeiras" subtitle="Financeiro · Classificação operacional" action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova categoria" />} />
      <FilterBar
        filters={[
          { key: 'name', label: 'Nome' },
          { key: 'type', label: 'Tipo', type: 'select', options: [{ value: 'INCOME', label: 'Receita' }, { value: 'EXPENSE', label: 'Despesa' }] },
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Categoria</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Natureza padrão (DRE)</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-stone-500">Nenhuma categoria cadastrada.</td></tr>}
              {items.map(c => (
                <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color || '#c9a961' }}></div>
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-sm ${c.type === 'INCOME' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {categoryTypeLabels[c.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.default_nature ? (
                      <span className="text-stone-700">{c.default_nature.name}</span>
                    ) : (
                      <span className="text-stone-400 italic">— não definida —</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-sm ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                      {c.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
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
        <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Nova categoria' : 'Editar categoria'} size="lg">
          <CategoryForm initial={modal.data} current={user} companies={companies} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a categoria" />
    </div>
  );
}
