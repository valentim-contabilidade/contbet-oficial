'use client';

import { useEffect, useState } from 'react';
import { Edit2, Trash2, DollarSign, Calendar, Layers, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatBRLInput, parseInputToCents, formatDate, todayInput, formatDocument } from '@/lib/format';
import type { AccountReceivable, Company, Brand, FinancialCategory, BankAccount } from '@/lib/types';
import type { FinancialNature } from '@/lib/nature-types';
import { dreSectionShortLabels, dreSectionColors } from '@/lib/nature-format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton, StatusBadge } from '@/components/ui';
import { ContactAutocomplete } from '@/components/contact-autocomplete';
import { NatureSelect } from '@/components/nature-select';

function ReceivableForm({ initial, current, companies, brands, categories, onSubmit, onCancel }: {
  initial?: Partial<AccountReceivable>;
  current: any;
  companies: Company[];
  brands: Brand[];
  categories: FinancialCategory[];
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    description: initial?.description ?? '',
    contact_id: initial?.contact_id ?? '',
    customer_name: initial?.customer_name ?? '',
    customer_doc: initial?.customer_doc ?? '',
    document_number: initial?.document_number ?? '',
    amount: initial?.amount ? formatBRLInput(parseInt(String(initial.amount))) : '',
    issue_date: initial?.issue_date ? new Date(initial.issue_date).toISOString().slice(0, 10) : todayInput(),
    due_date: initial?.due_date ? new Date(initial.due_date).toISOString().slice(0, 10) : todayInput(),
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    brand_id: initial?.brand_id ?? '',
    category_id: initial?.category_id ?? '',
    nature_id: (initial as any)?.nature_id ?? '',
    revenue_type: ((initial as any)?.revenue_type ?? 'NON_OPERATIONAL') as 'OPERATIONAL' | 'NON_OPERATIONAL',
    notes: initial?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;
  const filteredBrands = brands.filter(b => b.company_id === data.company_id);
  const incomeCategories = categories.filter(c => c.company_id === data.company_id && c.type === 'INCOME');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.description.trim() || data.description.length < 2) errs.description = 'Descrição obrigatória';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    if (!data.contact_id && (!data.customer_name || data.customer_name.length < 2)) errs.customer = 'Selecione um cliente ou digite o nome';
    if (!data.amount || parseInputToCents(data.amount) < 1) errs.amount = 'Valor obrigatório';
    if (!data.issue_date) errs.issue_date = 'Data de emissão obrigatória';
    if (!data.due_date) errs.due_date = 'Vencimento obrigatório';
    if (!isEdit && !data.nature_id) errs.nature_id = 'Natureza contábil obrigatória';
    setErrors(errs);

    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          description: data.description,
          document_number: data.document_number || undefined,
          amount: parseInputToCents(data.amount),
          issue_date: data.issue_date,
          due_date: data.due_date,
          notes: data.notes || undefined,
          brand_id: data.brand_id || undefined,
          category_id: data.category_id || undefined,
          nature_id: data.nature_id || undefined,
          revenue_type: data.revenue_type,
        };
        if (data.contact_id) {
          payload.contact_id = data.contact_id;
        } else {
          payload.customer_name = data.customer_name;
          payload.customer_doc = data.customer_doc || undefined;
        }
        if (!isEdit) payload.company_id = data.company_id;
        await onSubmit(payload);
      } catch (err: any) {
        setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' });
      } finally { setSubmitting(false); }
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!isEdit && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id} onChange={e => setData({ ...data, company_id: e.target.value, brand_id: '', category_id: '', nature_id: '' })}
            disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}

      <Field label="Descrição" required error={errors.description}>
        <Input value={data.description} onChange={e => setData({ ...data, description: e.target.value })}
          placeholder="Ex: PSP retido março/2026, reembolso fornecedor X" />
      </Field>

      <Field label="Tipo de receita" required>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setData({ ...data, revenue_type: 'OPERATIONAL' })}
            className={`px-3 py-2.5 rounded-sm text-sm border transition text-left ${data.revenue_type === 'OPERATIONAL' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
            <div className="font-medium">Operacional</div>
            <div className={`text-[10px] ${data.revenue_type === 'OPERATIONAL' ? 'text-stone-300' : 'text-stone-500'}`}>PSP retido, repasse de gateway</div>
          </button>
          <button type="button" onClick={() => setData({ ...data, revenue_type: 'NON_OPERATIONAL' })}
            className={`px-3 py-2.5 rounded-sm text-sm border transition text-left ${data.revenue_type === 'NON_OPERATIONAL' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
            <div className="font-medium">Não-operacional</div>
            <div className={`text-[10px] ${data.revenue_type === 'NON_OPERATIONAL' ? 'text-stone-300' : 'text-stone-500'}`}>Reembolso, recuperação tributária, royalties</div>
          </button>
        </div>
      </Field>

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Cliente" required error={errors.customer}>
          <ContactAutocomplete
            companyId={data.company_id}
            role="customer"
            value={data.contact_id}
            onChange={(contact) => {
              if (contact) {
                setData({ ...data, contact_id: contact.id, customer_name: contact.name, customer_doc: contact.document ?? '' });
              } else {
                setData({ ...data, contact_id: '', customer_name: '', customer_doc: '' });
              }
            }}
            placeholder="Buscar cliente..."
          />
        </Field>

        <Field label={
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-green-700" />
            Natureza Contábil (DRE)
          </span>
        } required error={errors.nature_id}>
          <NatureSelect
            companyId={data.company_id}
            type="RECEITA"
            value={data.nature_id || null}
            onChange={(natureId) => setData({ ...data, nature_id: natureId ?? '' })}
            required
          />
        </Field>
      </div>

      {!data.contact_id && (
        <div className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-stone-200">
          <Input value={data.customer_name} onChange={e => setData({ ...data, customer_name: e.target.value })}
            placeholder="Nome do cliente" />
          <Input value={data.customer_doc} onChange={e => setData({ ...data, customer_doc: e.target.value })}
            placeholder="CNPJ/CPF (opcional)" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)" required error={errors.amount}>
          <Input value={data.amount} onChange={e => setData({ ...data, amount: e.target.value })} placeholder="0,00" />
        </Field>
        <Field label="Documento (NF/Recibo)">
          <Input value={data.document_number} onChange={e => setData({ ...data, document_number: e.target.value })} placeholder="000123" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Emissão" required error={errors.issue_date}>
          <Input type="date" value={data.issue_date} onChange={e => setData({ ...data, issue_date: e.target.value })} />
        </Field>
        <Field label="Vencimento" required error={errors.due_date}>
          <Input type="date" value={data.due_date} onChange={e => setData({ ...data, due_date: e.target.value })} />
        </Field>
      </div>

      <div className="border border-stone-200 rounded-sm">
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-3 py-2 text-xs uppercase tracking-wider text-stone-600 flex items-center justify-between hover:bg-stone-50">
          <span>Opções avançadas (marca, categoria, observações)</span>
          <span className="text-stone-400">{showAdvanced ? '−' : '+'}</span>
        </button>

        {showAdvanced && (
          <div className="p-3 border-t border-stone-200 space-y-3 bg-stone-50/30">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marca (opcional)">
                <Select value={data.brand_id} onChange={e => setData({ ...data, brand_id: e.target.value })}>
                  <option value="">Nenhuma</option>
                  {filteredBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Categoria (visual, opcional)">
                <Select value={data.category_id} onChange={e => setData({ ...data, category_id: e.target.value })}>
                  <option value="">Nenhuma</option>
                  {incomeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Observações">
              <textarea value={data.notes ?? ''} onChange={e => setData({ ...data, notes: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[50px]" maxLength={2000} />
            </Field>
          </div>
        )}
      </div>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}

      <div className="flex justify-end gap-3 pt-3 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar conta'}</PrimaryButton>
      </div>
    </form>
  );
}

function ReceiveModal({ receivable, accounts, onSubmit, onCancel }: {
  receivable: AccountReceivable;
  accounts: BankAccount[];
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [receiptDate, setReceiptDate] = useState(todayInput());
  const [receivedAmount, setReceivedAmount] = useState(formatBRLInput(parseInt(String(receivable.amount))));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!accountId) { setError('Selecione a conta bancária'); return; }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        bank_account_id: accountId,
        receipt_date: receiptDate,
        received_amount: parseInputToCents(receivedAmount),
      });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao confirmar recebimento.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm">
        <div className="font-medium">{receivable.description}</div>
        <div className="text-stone-600 text-xs mt-1">Total: {formatBRL(receivable.amount)} · Vencimento: {formatDate(receivable.due_date)}</div>
      </div>
      <Field label="Conta bancária" required>
        <Select value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (saldo: {formatBRL(a.current_balance)})</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data do recebimento" required>
          <Input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
        </Field>
        <Field label="Valor recebido">
          <Input value={receivedAmount} onChange={e => setReceivedAmount(e.target.value)} />
        </Field>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Processando...' : 'Confirmar recebimento'}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function AccountsReceivablePage() {
  const { user } = useAuth();
  const [items, setItems] = useState<AccountReceivable[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | 'receive' | null; data?: AccountReceivable }>({ type: null });

  useEffect(() => {
    Promise.all([
      api.get('/companies'),
      api.get('/brands'),
      api.get('/financial/categories'),
      api.get('/financial/bank-accounts'),
    ]).then(([cs, bs, cats, accs]) => {
      setCompanies(cs.data.data);
      setBrands(bs.data.data);
      setCategories(cats.data.data);
      setAccounts(accs.data.data);
    });
  }, []);

  const reload = async () => {
    const res = await api.get('/financial/accounts-receivable', { params: { ...filters, page } });
    setItems(res.data.data);
    setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/financial/accounts-receivable/${modal.data.id}`, data);
    else await api.post('/financial/accounts-receivable', data);
    setModal({ type: null });
    await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/financial/accounts-receivable/${modal.data.id}`);
    setModal({ type: null });
    await reload();
  };

  const handleReceive = async (data: any) => {
    if (!modal.data) return;
    await api.post(`/financial/accounts-receivable/${modal.data.id}/receive`, data);
    setModal({ type: null });
    await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Recebíveis"
        subtitle="Receitas operacionais (PSP, retidos) e não-operacionais (reembolsos, recuperação tributária, royalties etc.)"
        action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova conta a receber" />}
      />

      <FilterBar
        filters={[
          { key: 'description', label: 'Descrição', placeholder: 'Buscar...' },
          { key: 'customer_name', label: 'Cliente', placeholder: 'Buscar...' },
          { key: 'company_id', label: 'Empresa', type: 'select', options: companies.map(c => ({ value: c.id, label: c.name })) },
          { key: 'revenue_type', label: 'Tipo de receita', type: 'select', options: [
            { value: 'OPERATIONAL', label: 'Operacional' },
            { value: 'NON_OPERATIONAL', label: 'Não-operacional' },
          ]},
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'PENDING', label: 'Pendente' },
            { value: 'PAID', label: 'Recebida' },
            { value: 'OVERDUE', label: 'Vencida' },
            { value: 'PARTIAL', label: 'Parcial' },
            { value: 'CANCELLED', label: 'Cancelada' },
          ]},
          { key: 'due_from', label: 'Vence de' },
          { key: 'due_to', label: 'Vence até' },
        ]}
        values={filters}
        onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Descrição</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Cliente</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Natureza</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Valor</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Vencimento</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-stone-500">Nenhuma conta encontrada.</td></tr>
              )}
              {items.map(r => {
                const nature = (r as any).nature as FinancialNature | undefined;
                return (
                  <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.description}</div>
                      {r.document_number && <div className="text-xs text-stone-500 mt-0.5"><Receipt className="w-3 h-3 inline mr-1" />{r.document_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{r.customer_name || '—'}</div>
                      {r.customer_doc && <div className="text-xs text-stone-500 font-mono">{formatDocument(r.customer_doc)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {nature ? (
                        <div>
                          <div className="text-sm">{nature.name}</div>
                          <span className={`inline-block text-xs px-1.5 py-0.5 rounded-sm uppercase tracking-wider mt-0.5 ${dreSectionColors[nature.dre_section]}`}>
                            {dreSectionShortLabels[nature.dre_section]}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-sm border border-amber-200">⚠ Sem natureza</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatBRL(r.amount)}</td>
                    <td className="px-4 py-3 text-stone-700"><Calendar className="w-3.5 h-3.5 inline mr-1 text-stone-400" />{formatDate(r.due_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.status !== 'PAID' && r.status !== 'CANCELLED' && (
                        <button onClick={() => setModal({ type: 'receive', data: r })}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-sm" title="Receber">
                          <DollarSign className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => setModal({ type: 'edit', data: r })}
                        className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm ml-1"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setModal({ type: 'delete', data: r })}
                        className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })}
        title={modal.type === 'create' ? 'Novo recebível' : 'Editar recebível'} size="lg">
        {user && <ReceivableForm initial={modal.data} current={user} companies={companies}
          brands={brands} categories={categories} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />}
      </Modal>

      <Modal open={modal.type === 'receive'} onClose={() => setModal({ type: null })} title="Confirmar recebimento" size="md">
        {modal.data && <ReceiveModal receivable={modal.data} accounts={accounts.filter(a => a.company_id === modal.data?.company_id)}
          onSubmit={handleReceive} onCancel={() => setModal({ type: null })} />}
      </Modal>

      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })}
        onConfirm={handleDelete}
        entityName={modal.data?.description}
        entityLabel="a conta a receber" />
    </div>
  );
}
