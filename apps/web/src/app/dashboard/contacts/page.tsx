'use client';

import { useEffect, useState } from 'react';
import { UserCheck, Edit2, Trash2, User, Building2, Briefcase, Star, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Contact, Company, Brand, ContactPersonType } from '@/lib/types';
import { formatDocument, formatPhone, formatBRL, personTypeLabels, buildContactBadges, todayInput } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';
import { CurrencyInput } from '@/components/financial-ui';
import { NatureSelect } from '@/components/nature-select';

function ContactForm({ initial, onSubmit, onCancel, current, companies, brands }: { initial?: Partial<Contact>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[]; brands: Brand[] }) {
  const isEdit = !!initial?.id;
  const initialBase = (initial as any)?.employee_base_salary ? Number((initial as any).employee_base_salary) : 0;
  const initialVar = (initial as any)?.employee_variable_salary ? Number((initial as any).employee_variable_salary) : 0;
  const legacyTotal = initial?.employee_salary ? Number(initial.employee_salary) : 0;
  const [data, setData] = useState({
    person_type: (initial?.person_type ?? 'INDIVIDUAL') as ContactPersonType,
    name: initial?.name ?? '',
    trade_name: initial?.trade_name ?? '',
    document: initial?.document ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    number: initial?.number ?? '',
    complement: initial?.complement ?? '',
    neighborhood: initial?.neighborhood ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    zip_code: initial?.zip_code ?? '',
    is_customer: initial?.is_customer ?? false,
    is_supplier: initial?.is_supplier ?? false,
    is_employee: initial?.is_employee ?? false,
    is_partner: initial?.is_partner ?? false,
    employee_role: initial?.employee_role ?? '',
    employee_base_salary: initialBase || (initialVar === 0 ? legacyTotal : 0),
    employee_variable_salary: initialVar,
    employee_admission_date: initial?.employee_admission_date ? initial.employee_admission_date.split('T')[0] : '',
    partner_share_percentage: initial?.partner_share_percentage ? Number(initial.partner_share_percentage) : 0,
    notes: initial?.notes ?? '',
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    brand_id: (initial as any)?.brand_id ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    if (!data.is_customer && !data.is_supplier && !data.is_employee && !data.is_partner) {
      errs.types = 'Selecione pelo menos um tipo de pessoa';
    }
    if (data.is_employee && !data.employee_role) errs.employee_role = 'Cargo obrigatório para funcionário';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          person_type: data.person_type,
          name: data.name,
          is_customer: data.is_customer,
          is_supplier: data.is_supplier,
          is_employee: data.is_employee,
          is_partner: data.is_partner,
        };
        if (data.trade_name) payload.trade_name = data.trade_name;
        if (data.document) payload.document = data.document.replace(/\D/g, '');
        if (data.email) payload.email = data.email;
        if (data.phone) payload.phone = data.phone.replace(/\D/g, '');
        if (data.address) payload.address = data.address;
        if (data.number) payload.number = data.number;
        if (data.complement) payload.complement = data.complement;
        if (data.neighborhood) payload.neighborhood = data.neighborhood;
        if (data.city) payload.city = data.city;
        if (data.state) payload.state = data.state.toUpperCase();
        if (data.zip_code) payload.zip_code = data.zip_code;
        if (data.notes) payload.notes = data.notes;
        if (data.is_employee) {
          payload.employee_role = data.employee_role;
          if (data.employee_base_salary > 0) payload.employee_base_salary = data.employee_base_salary;
          if (data.employee_variable_salary > 0) payload.employee_variable_salary = data.employee_variable_salary;
          // Mantém employee_salary (total) sincronizado para folha automática.
          const total = (data.employee_base_salary || 0) + (data.employee_variable_salary || 0);
          if (total > 0) payload.employee_salary = total;
          if (data.employee_admission_date) payload.employee_admission_date = data.employee_admission_date;
          if (data.brand_id) payload.brand_id = data.brand_id;
        }
        if (data.is_partner && data.partner_share_percentage > 0) {
          payload.partner_share_percentage = data.partner_share_percentage;
        }
        if (!isEdit) payload.company_id = data.company_id;
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Tipo de pessoa" required>
        <div className="grid grid-cols-2 gap-2">
          {(['INDIVIDUAL', 'COMPANY'] as ContactPersonType[]).map(t => (
            <button key={t} type="button" onClick={() => setData({ ...data, person_type: t })}
              className={`px-3 py-2 rounded-sm text-sm border transition ${data.person_type === t ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
              {personTypeLabels[t]}
            </button>
          ))}
        </div>
      </Field>

      <Field label={data.person_type === 'COMPANY' ? 'Razão Social' : 'Nome completo'} required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder={data.person_type === 'COMPANY' ? 'Empresa Exemplo LTDA' : 'João da Silva'} />
      </Field>

      {data.person_type === 'COMPANY' && (
        <Field label="Nome Fantasia">
          <Input value={data.trade_name ?? ''} onChange={e => setData({ ...data, trade_name: e.target.value })} placeholder="Nome comercial" />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label={data.person_type === 'COMPANY' ? 'CNPJ' : 'CPF'}>
          <Input value={data.document ?? ''} onChange={e => setData({ ...data, document: e.target.value })} placeholder={data.person_type === 'COMPANY' ? '00.000.000/0001-00' : '000.000.000-00'} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={data.email ?? ''} onChange={e => setData({ ...data, email: e.target.value })} />
        </Field>
      </div>

      <Field label="Telefone">
        <Input value={data.phone ?? ''} onChange={e => setData({ ...data, phone: e.target.value })} placeholder="(00) 00000-0000" />
      </Field>

      {/* Tipos */}
      <Field label="Esta pessoa é..." required error={errors.types}>
        <div className="grid grid-cols-2 gap-2">
          <label className={`flex items-center gap-2 px-3 py-2.5 rounded-sm text-sm border cursor-pointer transition ${data.is_customer ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <input type="checkbox" checked={data.is_customer} onChange={e => setData({ ...data, is_customer: e.target.checked })} className="rounded" />
            <User className="w-4 h-4" /> Cliente
          </label>
          <label className={`flex items-center gap-2 px-3 py-2.5 rounded-sm text-sm border cursor-pointer transition ${data.is_supplier ? 'bg-purple-50 border-purple-300 text-purple-800' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <input type="checkbox" checked={data.is_supplier} onChange={e => setData({ ...data, is_supplier: e.target.checked })} className="rounded" />
            <Building2 className="w-4 h-4" /> Fornecedor
          </label>
          <label className={`flex items-center gap-2 px-3 py-2.5 rounded-sm text-sm border cursor-pointer transition ${data.is_employee ? 'bg-green-50 border-green-300 text-green-800' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <input type="checkbox" checked={data.is_employee} onChange={e => setData({ ...data, is_employee: e.target.checked })} className="rounded" />
            <Briefcase className="w-4 h-4" /> Funcionário
          </label>
          <label className={`flex items-center gap-2 px-3 py-2.5 rounded-sm text-sm border cursor-pointer transition ${data.is_partner ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <input type="checkbox" checked={data.is_partner} onChange={e => setData({ ...data, is_partner: e.target.checked })} className="rounded" />
            <Star className="w-4 h-4" /> Sócio
          </label>
        </div>
      </Field>

      {/* Campos de funcionário */}
      {data.is_employee && (
        <div className="bg-green-50/50 p-4 rounded-sm border border-green-200 space-y-4">
          <div className="text-xs uppercase tracking-wider text-green-800 font-medium flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5" /> Dados de Funcionário
          </div>
          <Field label="Cargo" required error={errors.employee_role}>
            <Input value={data.employee_role ?? ''} onChange={e => setData({ ...data, employee_role: e.target.value })} placeholder="Ex: Analista Contábil" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Salário base">
              <CurrencyInput value={data.employee_base_salary} onChange={v => setData({ ...data, employee_base_salary: v })} />
            </Field>
            <Field label="Salário variável">
              <CurrencyInput value={data.employee_variable_salary} onChange={v => setData({ ...data, employee_variable_salary: v })} />
            </Field>
          </div>
          <div className="text-xs text-stone-500 -mt-2">Total mensal: será usado na geração automática de folha.</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Marca em que está alocado">
              <Select value={data.brand_id ?? ''} onChange={e => setData({ ...data, brand_id: e.target.value })}>
                <option value="">Nenhuma</option>
                {brands.filter(b => b.company_id === data.company_id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              {!data.company_id && <div className="text-xs text-amber-700 mt-1">Selecione a empresa primeiro.</div>}
            </Field>
            <Field label="Data de admissão">
              <Input type="date" value={data.employee_admission_date} onChange={e => setData({ ...data, employee_admission_date: e.target.value })} />
            </Field>
          </div>
        </div>
      )}

      {/* Campos de sócio */}
      {data.is_partner && (
        <div className="bg-amber-50/50 p-4 rounded-sm border border-amber-200 space-y-4">
          <div className="text-xs uppercase tracking-wider text-amber-800 font-medium flex items-center gap-2">
            <Star className="w-3.5 h-3.5" /> Dados de Sócio
          </div>
          <Field label="% de participação societária">
            <Input type="number" step="0.01" min="0" max="100" value={data.partner_share_percentage} onChange={e => setData({ ...data, partner_share_percentage: parseFloat(e.target.value) || 0 })} placeholder="Ex: 25.50" />
          </Field>
        </div>
      )}

      {/* Endereço */}
      <details className="bg-stone-50 p-4 rounded-sm border border-stone-200">
        <summary className="text-xs uppercase tracking-wider text-stone-700 font-medium cursor-pointer">Endereço (opcional)</summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="Logradouro">
                <Input value={data.address ?? ''} onChange={e => setData({ ...data, address: e.target.value })} placeholder="Rua, Avenida..." />
              </Field>
            </div>
            <Field label="Número">
              <Input value={data.number ?? ''} onChange={e => setData({ ...data, number: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Complemento">
              <Input value={data.complement ?? ''} onChange={e => setData({ ...data, complement: e.target.value })} />
            </Field>
            <Field label="Bairro">
              <Input value={data.neighborhood ?? ''} onChange={e => setData({ ...data, neighborhood: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="Cidade">
                <Input value={data.city ?? ''} onChange={e => setData({ ...data, city: e.target.value })} />
              </Field>
            </div>
            <Field label="UF">
              <Input maxLength={2} value={data.state ?? ''} onChange={e => setData({ ...data, state: e.target.value.toUpperCase() })} placeholder="PB" />
            </Field>
          </div>
          <Field label="CEP">
            <Input value={data.zip_code ?? ''} onChange={e => setData({ ...data, zip_code: e.target.value })} placeholder="00000-000" />
          </Field>
        </div>
      </details>

      {!isEdit && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id ?? ''} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}

      <Field label="Observações">
        <textarea value={data.notes ?? ''} onChange={e => setData({ ...data, notes: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar'}</PrimaryButton>
      </div>
    </form>
  );
}

function GeneratePayrollModal({ companies, current, onConfirmed, onCancel }: {
  companies: Company[];
  current: any;
  onConfirmed: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const today = new Date();
  const [step, setStep] = useState<'config' | 'preview'>('config');
  const [companyId, setCompanyId] = useState<string>(current.profile === 'MANAGER' ? current.company_id : '');
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [dueDay, setDueDay] = useState(5);
  const [natureId, setNatureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<any | null>(null);

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  const goPreview = async () => {
    if (!companyId) { setError('Selecione a empresa.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/contacts/payroll-preview', { company_id: companyId, month, year });
      setPreview(res.data);
      setStep('preview');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao gerar prévia.');
    } finally { setLoading(false); }
  };

  const confirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/contacts/generate-payroll', {
        company_id: companyId, month, year,
        nature_id: natureId || undefined,
        due_day: dueDay,
      });
      alert(`Folha gerada: ${res.data.created} criadas, ${res.data.skipped} ignoradas (já existentes).`);
      await onConfirmed();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao gerar folha.');
    } finally { setSubmitting(false); }
  };

  if (step === 'config') {
    return (
      <div className="space-y-4">
        <div className="bg-stone-50 p-4 rounded-sm border border-stone-200 text-sm text-stone-700">
          Configure o período, a natureza contábil (DRE) e o dia do vencimento.
          Em seguida você verá uma <strong>prévia</strong> antes de confirmar a geração.
        </div>

        <Field label="Empresa" required>
          <Select value={companyId} onChange={e => { setCompanyId(e.target.value); setNatureId(null); }}
            disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Mês" required>
            <Select value={String(month)} onChange={e => setMonth(parseInt(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
            </Select>
          </Field>
          <Field label="Ano" required>
            <Input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} />
          </Field>
          <Field label="Vence dia">
            <Input type="number" min={1} max={28} value={dueDay} onChange={e => setDueDay(Math.max(1, Math.min(28, parseInt(e.target.value) || 5)))} />
          </Field>
        </div>

        <Field label="Natureza contábil (DRE)" required>
          <NatureSelect companyId={companyId} type="DESPESA" value={natureId}
            onChange={(id) => setNatureId(id)} required />
        </Field>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

        <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
          <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
          <PrimaryButton type="button" onClick={goPreview} disabled={loading || !companyId || !natureId}>
            {loading ? 'Gerando prévia...' : 'Próximo: ver prévia'}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  // step === 'preview'
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-sm text-blue-900">
        Confira a lista. Itens marcados como <em>já existente</em> serão ignorados (não duplicam).
      </div>

      <div className="bg-stone-50 p-3 rounded-sm border border-stone-200 text-sm grid grid-cols-3 gap-2">
        <div><span className="text-stone-500 text-xs">A criar:</span> <strong>{preview?.to_create_count ?? 0}</strong></div>
        <div><span className="text-stone-500 text-xs">Ignorados:</span> <strong>{preview?.to_skip_count ?? 0}</strong></div>
        <div className="text-right"><span className="text-stone-500 text-xs">Total a lançar:</span> <strong className="font-mono">{formatBRL(preview?.total_amount ?? '0')}</strong></div>
      </div>

      <div className="border border-stone-200 rounded-sm overflow-hidden max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Funcionário</th>
              <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Cargo / Marca</th>
              <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Salário</th>
              <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {(preview?.employees ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-stone-500">Nenhum funcionário ativo com salário cadastrado.</td></tr>
            )}
            {(preview?.employees ?? []).map((e: any) => (
              <tr key={e.contact_id} className="border-b border-stone-100">
                <td className="px-3 py-2">{e.name}</td>
                <td className="px-3 py-2 text-xs text-stone-600">{e.role || '—'}{e.brand?.name ? ` · ${e.brand.name}` : ''}</td>
                <td className="px-3 py-2 text-right font-mono">{formatBRL(e.total_salary)}</td>
                <td className="px-3 py-2 text-right">
                  {e.already_exists
                    ? <span className="text-xs px-2 py-0.5 rounded-sm bg-amber-50 text-amber-800 border border-amber-200">já existente</span>
                    : <span className="text-xs px-2 py-0.5 rounded-sm bg-green-50 text-green-800 border border-green-200">a criar</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={() => setStep('config')}>Voltar</SecondaryButton>
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={confirm} disabled={submitting || (preview?.to_create_count ?? 0) === 0}>
          {submitting ? 'Gerando...' : `Confirmar geração (${preview?.to_create_count ?? 0})`}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | 'payroll' | null; data?: Contact }>({ type: null });

  const reload = async () => {
    const res = await api.get('/contacts', { params: { ...filters, page } });
    setItems(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => {
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
    api.get('/brands').then(r => setBrands(r.data.data)).catch(() => {});
  }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/contacts/${modal.data.id}`, data);
    else await api.post('/contacts', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/contacts/${modal.data.id}`);
    setModal({ type: null }); await reload();
  };

  const handlePayrollDone = async () => {
    setModal({ type: null });
    await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Pessoas"
        subtitle="Clientes, fornecedores, funcionários e sócios"
        action={
          <div className="flex gap-2">
            <SecondaryButton onClick={() => setModal({ type: 'payroll' })}>
              <Calendar className="w-4 h-4 inline mr-2" /> Gerar folha
            </SecondaryButton>
            <NewButton onClick={() => setModal({ type: 'create' })} label="Nova pessoa" />
          </div>
        }
      />
      <FilterBar
        filters={[
          { key: 'name', label: 'Nome' },
          { key: 'document', label: 'CPF/CNPJ' },
          { key: 'is_customer', label: 'Tipo', type: 'select', options: [
            { value: '', label: 'Todos' },
          ]},
        ]}
        values={filters} onChange={setFilters}
      />

      {/* Botões de filtro rápido por tipo */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilters({ ...filters, is_customer: '', is_supplier: '', is_employee: '', is_partner: '' })}
          className="px-3 py-1.5 text-xs rounded-sm border border-stone-300 bg-white hover:bg-stone-50">Todos</button>
        <button onClick={() => setFilters({ ...filters, is_customer: 'true', is_supplier: '', is_employee: '', is_partner: '' })}
          className="px-3 py-1.5 text-xs rounded-sm border border-blue-300 bg-blue-50 text-blue-800">Clientes</button>
        <button onClick={() => setFilters({ ...filters, is_customer: '', is_supplier: 'true', is_employee: '', is_partner: '' })}
          className="px-3 py-1.5 text-xs rounded-sm border border-purple-300 bg-purple-50 text-purple-800">Fornecedores</button>
        <button onClick={() => setFilters({ ...filters, is_customer: '', is_supplier: '', is_employee: 'true', is_partner: '' })}
          className="px-3 py-1.5 text-xs rounded-sm border border-green-300 bg-green-50 text-green-800">Funcionários</button>
        <button onClick={() => setFilters({ ...filters, is_customer: '', is_supplier: '', is_employee: '', is_partner: 'true' })}
          className="px-3 py-1.5 text-xs rounded-sm border border-amber-300 bg-amber-50 text-amber-800">Sócios</button>
      </div>

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nome</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Documento</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Contato</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipos</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-stone-500">Nenhuma pessoa cadastrada.</td></tr>}
              {items.map(c => {
                const badges = buildContactBadges(c);
                return (
                  <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {c.person_type === 'COMPANY' ? <Building2 className="w-5 h-5 text-stone-400" strokeWidth={1.5} /> : <User className="w-5 h-5 text-stone-400" strokeWidth={1.5} />}
                        <div>
                          <div className="font-medium">{c.name}</div>
                          {c.trade_name && <div className="text-xs text-stone-500">{c.trade_name}</div>}
                          {c.is_employee && c.employee_role && <div className="text-xs text-stone-500 italic">{c.employee_role}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-700">{formatDocument(c.document)}</td>
                    <td className="px-4 py-3 text-xs text-stone-700">
                      {c.email && <div>{c.email}</div>}
                      {c.phone && <div>{formatPhone(c.phone)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {badges.map(b => (
                          <span key={b} className={`text-xs px-2 py-0.5 rounded-sm ${
                            b === 'Cliente' ? 'bg-blue-50 text-blue-700' :
                            b === 'Fornecedor' ? 'bg-purple-50 text-purple-700' :
                            b === 'Funcionário' ? 'bg-green-50 text-green-700' :
                            'bg-amber-50 text-amber-800'
                          }`}>{b}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setModal({ type: 'edit', data: c })} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setModal({ type: 'delete', data: c })} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
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
        <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Nova pessoa' : 'Editar pessoa'} size="lg">
          <ContactForm initial={modal.data} current={user} companies={companies} brands={brands} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <Modal open={modal.type === 'payroll'} onClose={() => setModal({ type: null })} title="Gerar folha de pagamento" size="lg">
        {user && <GeneratePayrollModal companies={companies} current={user}
          onConfirmed={handlePayrollDone} onCancel={() => setModal({ type: null })} />}
      </Modal>
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a pessoa" />
    </div>
  );
}
