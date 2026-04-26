'use client';

import { useEffect, useState } from 'react';
import { Building2, Edit2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Bank } from '@/lib/types';
import { PageHeader, FilterBar, Modal, ConfirmDeleteModal, Field, Input, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';

function BankForm({ initial, onSubmit, onCancel }: { initial?: Partial<Bank>; onSubmit: (data: any) => Promise<void>; onCancel: () => void }) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    ispb: initial?.ispb ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!isEdit && !/^\d{3}$/.test(data.code)) errs.code = 'Código deve ter 3 dígitos';
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = { name: data.name };
        if (!isEdit) payload.code = data.code;
        if (data.ispb) payload.ispb = data.ispb;
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Código COMPE" required error={errors.code}>
          <Input value={data.code} onChange={e => setData({ ...data, code: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="341" disabled={isEdit} />
        </Field>
        <div className="col-span-2">
          <Field label="Nome do banco" required error={errors.name}>
            <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Itaú Unibanco S.A." />
          </Field>
        </div>
      </div>
      <Field label="ISPB (opcional)">
        <Input value={data.ispb ?? ''} onChange={e => setData({ ...data, ispb: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="60701190" maxLength={8} />
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function BanksPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Bank[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: Bank }>({ type: null });

  const reload = async () => {
    const res = await api.get('/banks', { params: filters });
    setItems(res.data.data);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters]);

  const isAdmin = user?.profile === 'ADMIN';

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/banks/${modal.data.id}`, data);
    else await api.post('/banks', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    try {
      await api.delete(`/banks/${modal.data.id}`);
      setModal({ type: null }); await reload();
    } catch (err: any) { alert(err.response?.data?.message ?? 'Erro ao excluir'); }
  };

  return (
    <div>
      <PageHeader
        title="Catálogo de Bancos"
        subtitle="Instituições financeiras brasileiras"
        action={isAdmin ? <NewButton onClick={() => setModal({ type: 'create' })} label="Novo banco" /> : undefined}
      />
      {!isAdmin && (
        <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-sm text-sm text-blue-800 mb-4">
          Apenas administradores podem editar o catálogo de bancos. O catálogo é compartilhado por todas as empresas do sistema.
        </div>
      )}
      <FilterBar
        filters={[{ key: 'name', label: 'Nome' }, { key: 'code', label: 'Código' }]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Código</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nome</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">ISPB</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                {isAdmin && <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={isAdmin ? 5 : 4} className="text-center py-12 text-stone-500">Nenhum banco cadastrado.</td></tr>}
              {items.map(b => (
                <tr key={b.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Building2 className="w-4 h-4 text-stone-400" strokeWidth={1.5} />
                      <span className="font-medium">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{b.ispb || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-sm ${b.is_active ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                      {b.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setModal({ type: 'edit', data: b })} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setModal({ type: 'delete', data: b })} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Novo banco' : 'Editar banco'} size="md">
        <BankForm initial={modal.data} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
      </Modal>
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="o banco" />
    </div>
  );
}
