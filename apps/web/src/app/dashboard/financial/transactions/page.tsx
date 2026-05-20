'use client';

import { useEffect, useState } from 'react';
import { Receipt, Edit2, Trash2, ArrowUpRight, ArrowDownLeft, ArrowLeftRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Transaction, Company, BankAccount, FinancialCategory, Brand, TransactionType } from '@/lib/types';
import { formatDate, todayInput, transactionTypeLabels } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';
import { CurrencyInput, MoneyText } from '@/components/financial-ui';

function TransactionForm({ onSubmit, onCancel, current, companies }: { onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[] }) {
  const [data, setData] = useState({
    description: '',
    type: 'INCOME' as TransactionType,
    amount: 0,
    date: todayInput(),
    bank_account_id: '',
    destination_account_id: '',
    category_id: '',
    brand_id: '',
    notes: '',
    reference: '',
    company_id: current.profile === 'MANAGER' ? current.company_id : '',
  });
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (data.company_id) {
      api.get('/financial/bank-accounts', { params: { company_id: data.company_id } })
        .then(r => setAccounts(r.data.data.filter((a: BankAccount) => a.is_active))).catch(() => {});
      api.get('/financial/categories', {
        params: { company_id: data.company_id, type: data.type === 'INCOME' ? 'INCOME' : data.type === 'EXPENSE' ? 'EXPENSE' : undefined }
      }).then(r => setCategories(r.data.data)).catch(() => {});
      api.get('/brands', { params: { company_id: data.company_id } }).then(r => setBrands(r.data.data)).catch(() => {});
    }
  }, [data.company_id, data.type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.description.trim()) errs.description = 'Descrição obrigatória';
    if (data.amount < 1) errs.amount = 'Valor obrigatório';
    if (!data.bank_account_id) errs.bank_account_id = 'Conta bancária obrigatória';
    if (data.type === 'TRANSFER' && !data.destination_account_id) errs.destination_account_id = 'Conta destino obrigatória';
    if (data.type === 'TRANSFER' && data.destination_account_id === data.bank_account_id) errs.destination_account_id = 'Origem e destino devem ser diferentes';
    if (!data.company_id) errs.company_id = 'Empresa obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          description: data.description,
          type: data.type,
          amount: data.amount,
          date: data.date,
          bank_account_id: data.bank_account_id,
          company_id: data.company_id,
        };
        if (data.type === 'TRANSFER') payload.destination_account_id = data.destination_account_id;
        if (data.category_id) payload.category_id = data.category_id;
        if (data.brand_id) payload.brand_id = data.brand_id;
        if (data.notes) payload.notes = data.notes;
        if (data.reference) payload.reference = data.reference;
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Tipo" required>
        <div className="grid grid-cols-3 gap-2">
          {(['INCOME', 'EXPENSE', 'TRANSFER'] as TransactionType[]).map(t => (
            <button key={t} type="button" onClick={() => setData({ ...data, type: t })}
              className={`px-3 py-2 rounded-sm text-sm border transition ${data.type === t ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
              {transactionTypeLabels[t]}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Descrição" required error={errors.description}>
        <Input value={data.description} onChange={e => setData({ ...data, description: e.target.value })} placeholder="Ex: Recebimento PSP, Pagamento de aluguel..." />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Valor" required error={errors.amount}>
          <CurrencyInput value={data.amount} onChange={v => setData({ ...data, amount: v })} />
        </Field>
        <Field label="Data" required>
          <Input type="date" value={data.date} onChange={e => setData({ ...data, date: e.target.value })} />
        </Field>
      </div>
      {!data.company_id && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label={data.type === 'TRANSFER' ? 'Conta de origem' : 'Conta bancária'} required error={errors.bank_account_id}>
        <Select value={data.bank_account_id} onChange={e => setData({ ...data, bank_account_id: e.target.value })}>
          <option value="">Selecione...</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      {data.type === 'TRANSFER' && (
        <Field label="Conta de destino" required error={errors.destination_account_id}>
          <Select value={data.destination_account_id} onChange={e => setData({ ...data, destination_account_id: e.target.value })}>
            <option value="">Selecione...</option>
            {accounts.filter(a => a.id !== data.bank_account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
      )}
      {data.type !== 'TRANSFER' && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Categoria">
            <Select value={data.category_id} onChange={e => setData({ ...data, category_id: e.target.value })}>
              <option value="">— Nenhuma —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Marca (opcional)">
            <Select value={data.brand_id} onChange={e => setData({ ...data, brand_id: e.target.value })}>
              <option value="">— Nenhuma —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>
      )}
      <Field label="Referência externa (opcional)">
        <Input value={data.reference} onChange={e => setData({ ...data, reference: e.target.value })} placeholder="TID, NSU, ID externo..." />
      </Field>
      <Field label="Observações">
        <textarea value={data.notes} onChange={e => setData({ ...data, notes: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar lançamento'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function TransactionsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Transaction[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'delete' | null; data?: Transaction }>({ type: null });

  const reload = async () => {
    const res = await api.get('/financial/transactions', { params: { ...filters, page } });
    setItems(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {}); }, []);

  const handleSave = async (data: any) => {
    await api.post('/financial/transactions', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    try {
      await api.delete(`/financial/transactions/${modal.data.id}`);
      setModal({ type: null }); await reload();
    } catch (err: any) { alert(err.response?.data?.message ?? 'Erro ao excluir'); }
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const typeIcon = (t: TransactionType) => {
    if (t === 'INCOME') return <ArrowDownLeft className="w-5 h-5 text-green-600" strokeWidth={1.5} />;
    if (t === 'EXPENSE') return <ArrowUpRight className="w-5 h-5 text-red-500" strokeWidth={1.5} />;
    return <ArrowLeftRight className="w-5 h-5 text-blue-600" strokeWidth={1.5} />;
  };

  return (
    <div>
      <PageHeader title="Caixa e Bancos" subtitle="Movimentações em contas bancárias — entradas e saídas realizadas" action={<NewButton onClick={() => setModal({ type: 'create' })} label="Novo lançamento" />} />
      <FilterBar
        filters={[
          { key: 'description', label: 'Descrição' },
          { key: 'type', label: 'Tipo', type: 'select', options: Object.entries(transactionTypeLabels).map(([v, l]) => ({ value: v, label: l })) },
          { key: 'date_from', label: 'De', placeholder: 'YYYY-MM-DD' },
          { key: 'date_to', label: 'Até', placeholder: 'YYYY-MM-DD' },
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Data</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Descrição</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Valor</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-stone-500">Nenhum lançamento encontrado.</td></tr>}
              {items.map(t => (
                <tr key={t.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 text-stone-700 font-mono text-xs">{formatDate(t.date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {typeIcon(t.type)}
                      <div>
                        <div className="font-medium">{t.description}</div>
                        {t.category && <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: t.category.color || '#c9a961' }}></span>{t.category.name}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-700 text-xs">
                    {t.bank_account?.name}
                    {t.destination_account && <> → {t.destination_account.name}</>}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${t.type === 'INCOME' ? 'text-green-700' : t.type === 'EXPENSE' ? 'text-red-700' : 'text-blue-700'}`}>
                    {t.type === 'INCOME' && '+ '}{t.type === 'EXPENSE' && '- '}<MoneyText cents={t.amount} className="!text-inherit" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setModal({ type: 'delete', data: t })} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      {user && (
        <Modal open={modal.type === 'create'} onClose={() => setModal({ type: null })} title="Novo lançamento" size="lg">
          <TransactionForm current={user} companies={companies} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.description} entityLabel="o lançamento" />
    </div>
  );
}
