'use client';

import { useEffect, useState, useMemo } from 'react';
import { CircleUser, Edit2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { User, Company, Brand, Profile } from '@/lib/types';
import { profileLabel } from '@/lib/types';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton, ProfileBadge } from '@/components/ui';

function UserForm({ initial, onSubmit, onCancel, current }: { initial?: Partial<User>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: User }) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    name: initial?.name ?? '', username: initial?.username ?? '', email: initial?.email ?? '',
    password: '', profile: (initial?.profile ?? 'OWNER') as Profile,
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id ?? '' : ''),
    brand_id: initial?.brand_id ?? '', status: initial?.status ?? 'ACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const allowedProfiles = useMemo<Profile[]>(() => {
    if (current.profile === 'ADMIN') return ['ADMIN', 'MANAGER', 'OWNER'];
    if (current.profile === 'MANAGER') return ['OWNER'];
    return [];
  }, [current.profile]);

  useEffect(() => {
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (data.company_id) {
      api.get('/brands', { params: { company_id: data.company_id } }).then(r => setBrands(r.data.data)).catch(() => {});
    } else setBrands([]);
  }, [data.company_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim()) errs.name = 'Nome obrigatório';
    if (!data.username.trim()) errs.username = 'Username obrigatório';
    if (!data.email.trim() || !/.+@.+\..+/.test(data.email)) errs.email = 'E-mail inválido';
    if (!isEdit && data.password.length < 6) errs.password = 'Senha mínima de 6 caracteres';
    if (!data.profile) errs.profile = 'Perfil obrigatório';
    if (data.profile !== 'ADMIN' && !data.company_id) errs.company_id = 'Empresa obrigatória';
    if (data.profile === 'OWNER' && !data.brand_id) errs.brand_id = 'Marca obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          name: data.name, email: data.email, profile: data.profile, status: data.status,
          company_id: data.profile === 'ADMIN' ? null : data.company_id,
          brand_id: data.profile === 'OWNER' ? data.brand_id : null,
        };
        if (!isEdit) { payload.username = data.username; payload.password = data.password; }
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome" required error={errors.name}><Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Username" required error={errors.username}>
          <Input value={data.username} onChange={e => setData({ ...data, username: e.target.value.toLowerCase().trim() })} disabled={isEdit} />
        </Field>
        <Field label="E-mail" required error={errors.email}>
          <Input type="email" value={data.email} onChange={e => setData({ ...data, email: e.target.value })} />
        </Field>
      </div>
      {!isEdit && (
        <Field label="Senha" required error={errors.password}>
          <Input type="password" value={data.password} onChange={e => setData({ ...data, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Perfil" required error={errors.profile}>
          <Select value={data.profile} onChange={e => setData({ ...data, profile: e.target.value as Profile, company_id: e.target.value === 'ADMIN' ? '' : data.company_id, brand_id: e.target.value !== 'OWNER' ? '' : data.brand_id })}>
            {allowedProfiles.map(p => <option key={p} value={p}>{profileLabel(p)}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={data.status} onChange={e => setData({ ...data, status: e.target.value as any })}>
            <option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option>
          </Select>
        </Field>
      </div>
      {data.profile !== 'ADMIN' && (
        <Field label="Empresa vinculada" required error={errors.company_id}>
          <Select value={data.company_id ?? ''} onChange={e => setData({ ...data, company_id: e.target.value, brand_id: '' })} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.filter(c => current.profile !== 'MANAGER' || c.id === current.company_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      {data.profile === 'OWNER' && data.company_id && (
        <Field label="Marca vinculada" required error={errors.brand_id}>
          <Select value={data.brand_id ?? ''} onChange={e => setData({ ...data, brand_id: e.target.value })}>
            <option value="">Selecione...</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          {brands.length === 0 && <div className="text-xs text-stone-500 mt-1">Esta empresa não tem marcas cadastradas.</div>}
        </Field>
      )}
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar usuário'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: User }>({ type: null });

  const reload = async () => {
    const res = await api.get('/users', { params: { ...filters, page } });
    setUsers(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {}); }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/users/${modal.data.id}`, data);
    else await api.post('/users', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/users/${modal.data.id}`);
    setModal({ type: null }); await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Você não tem permissão para acessar este módulo.</div>;
  }

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Cadastro · Acesso ao sistema" action={<NewButton onClick={() => setModal({ type: 'create' })} label="Novo usuário" />} />
      <FilterBar
        filters={[
          { key: 'name', label: 'Nome' },
          { key: 'username', label: 'Username' },
          { key: 'profile', label: 'Perfil', type: 'select', options: [
            { value: 'ADMIN', label: 'ADMIN' }, { value: 'MANAGER', label: 'MASTER' }, { value: 'OWNER', label: 'GESTOR' },
          ]},
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nome</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Username</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Perfil</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Empresa</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-stone-500">Nenhum usuário encontrado.</td></tr>}
              {users.map(u => {
                const c = companies.find(x => x.id === u.company_id);
                return (
                  <tr key={u.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <CircleUser className="w-7 h-7 text-stone-400" strokeWidth={1.5} />
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-stone-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3"><ProfileBadge profile={u.profile} /></td>
                    <td className="px-4 py-3 text-stone-700">{c?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-sm ${u.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                        {u.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setModal({ type: 'edit', data: u })} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setModal({ type: 'delete', data: u })} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      {user && (
        <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Novo usuário' : 'Editar usuário'} size="lg">
          <UserForm initial={modal.data} current={user} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="o usuário" />
    </div>
  );
}
