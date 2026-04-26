'use client';

import { useEffect, useState } from 'react';
import { Building2, Edit2, Trash2, Upload, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
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

function CompanyForm({ initial, onSubmit, onCancel }: { initial?: Partial<Company>; onSubmit: (data: any) => Promise<void>; onCancel: () => void }) {
  const [data, setData] = useState({
    name: initial?.name ?? '', cnpj: initial?.cnpj ? formatCNPJ(initial.cnpj) : '',
    address: initial?.address ?? '', city: initial?.city ?? '', state: initial?.state ?? '',
    logo: initial?.logo ?? '',
    tax_regime: ((initial as any)?.tax_regime ?? 'LUCRO_REAL') as TaxRegime,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoError, setLogoError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
        if (!isEdit) payload.cnpj = data.cnpj;
        await onSubmit(payload);
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
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar empresa'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function CompaniesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: Company }>({ type: null });
  const [selected, setSelected] = useState<Company | null>(null);

  const reload = async () => {
    const res = await api.get('/companies', { params: { ...filters, page } });
    setCompanies(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/companies/${modal.data.id}`, data);
    else await api.post('/companies', data);
    setModal({ type: null }); await reload();
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
        <PageHeader title={selected.name} subtitle="Detalhes da empresa" />
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

        <Modal open={modal.type === 'edit'} onClose={() => setModal({ type: null })} title="Editar empresa" size="lg">
          {modal.data && <CompanyForm initial={modal.data} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />}
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
        <CompanyForm initial={modal.data} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
      </Modal>
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a empresa" />
    </div>
  );
}
