'use client';

import { useEffect, useState } from 'react';
import { Tag, Edit2, Trash2, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Brand, Company } from '@/lib/types';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';

function BrandForm({ initial, onSubmit, onCancel, current, companies }: { initial?: Partial<Brand>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[] }) {
  const [data, setData] = useState({
    name: initial?.name ?? '', domain: initial?.domain ?? '', description: initial?.description ?? '',
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    status: initial?.status ?? 'ACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 3) errs.name = 'Nome com mínimo de 3 caracteres';
    if (data.name.length > 80) errs.name = 'Máximo 80 caracteres';
    if (data.domain && !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(data.domain)) errs.domain = 'Domínio inválido (ex: marca.com.br)';
    if (!data.company_id) errs.company_id = 'Empresa obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = { name: data.name, status: data.status };
        if (data.domain) payload.domain = data.domain;
        if (data.description) payload.description = data.description;
        if (!initial?.id) payload.company_id = data.company_id;
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
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
      <Field label="Empresa" required error={errors.company_id}>
        <Select value={data.company_id ?? ''} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={!!initial?.id || current.profile === 'MANAGER'}>
          <option value="">Selecione...</option>
          {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
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

export default function BrandsPage() {
  const { user } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: Brand }>({ type: null });
  const [selected, setSelected] = useState<Brand | null>(null);

  const reload = async () => {
    const res = await api.get('/brands', { params: { ...filters, page } });
    setBrands(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => {
    if (user?.profile === 'ADMIN' || user?.profile === 'MANAGER') {
      api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
    }
  }, [user]);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/brands/${modal.data.id}`, data);
    else await api.post('/brands', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/brands/${modal.data.id}`);
    setModal({ type: null }); setSelected(null); await reload();
  };

  const canEdit = user?.profile === 'ADMIN';

  if (user && user.profile !== 'ADMIN') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Apenas administradores têm acesso ao cadastro de marcas.</div>;
  }

  if (selected) {
    return (
      <div>
        <button onClick={() => setSelected(null)} className="text-sm text-stone-600 hover:text-ink mb-6 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Voltar para listagem
        </button>
        <PageHeader title={selected.name} subtitle="Detalhes da marca" />
        <div className="bg-white border border-stone-200 rounded-sm p-8 space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div><div className="text-xs uppercase tracking-wider text-stone-500">Domínio</div><div>{selected.domain || '—'}</div></div>
            <div><div className="text-xs uppercase tracking-wider text-stone-500">Empresa</div><div>{selected.company?.name || '—'}</div></div>
            <div><div className="text-xs uppercase tracking-wider text-stone-500">Status</div>
              <span className={`text-xs px-2 py-1 rounded-sm ${selected.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                {selected.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
              </span>
            </div>
          </div>
          {selected.description && (
            <div className="pt-4 border-t border-stone-200">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Descrição</div>
              <p className="text-stone-700 leading-relaxed">{selected.description}</p>
            </div>
          )}
          {canEdit && (
            <div className="flex gap-2 pt-4 border-t border-stone-200">
              <PrimaryButton onClick={() => setModal({ type: 'edit', data: selected })}><Edit2 className="w-4 h-4" /> Editar</PrimaryButton>
              <SecondaryButton onClick={() => setModal({ type: 'delete', data: selected })} className="!text-red-600 hover:!bg-red-50">
                <Trash2 className="w-4 h-4 inline mr-2" />Excluir
              </SecondaryButton>
            </div>
          )}
        </div>
        {user && (
          <Modal open={modal.type === 'edit'} onClose={() => setModal({ type: null })} title="Editar marca" size="lg">
            {modal.data && <BrandForm initial={modal.data} current={user} companies={companies} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />}
          </Modal>
        )}
        <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a marca" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Marcas" subtitle="Cadastro · Produtos comerciais" action={canEdit && <NewButton onClick={() => setModal({ type: 'create' })} label="Nova marca" />} />
      <FilterBar
        filters={[
          { key: 'name', label: 'Nome' },
          { key: 'domain', label: 'Domínio' },
          ...(user?.profile === 'ADMIN' ? [{ key: 'company_id', label: 'Empresa', type: 'select' as const, options: companies.map(c => ({ value: c.id, label: c.name })) }] : []),
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Marca</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Domínio</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Empresa</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {brands.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-stone-500">Nenhuma marca cadastrada.</td></tr>}
              {brands.map(b => (
                <tr key={b.id} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => setSelected(b)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Tag className="w-5 h-5 text-gold" strokeWidth={1.5} />
                      <span className="font-medium">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{b.domain || '—'}</td>
                  <td className="px-4 py-3 text-stone-700">{b.company?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-sm ${b.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                      {b.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && <>
                      <button onClick={(e) => { e.stopPropagation(); setModal({ type: 'edit', data: b }); }} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); setModal({ type: 'delete', data: b }); }} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      {user && (
        <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Nova marca' : 'Editar marca'} size="lg">
          <BrandForm initial={modal.data} current={user} companies={companies} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a marca" />
    </div>
  );
}
