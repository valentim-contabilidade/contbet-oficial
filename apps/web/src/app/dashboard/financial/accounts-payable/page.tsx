'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Edit2, Trash2, DollarSign, Calendar, Layers, Receipt, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatBRLInput, parseInputToCents, formatDate, todayInput, formatDocument } from '@/lib/format';
import type { AccountPayable, Company, Brand, FinancialCategory, BankAccount, ChartOfAccount } from '@/lib/types';
import type { FinancialNature } from '@/lib/nature-types';
import { dreSectionShortLabels, dreSectionColors } from '@/lib/nature-format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton, StatusBadge } from '@/components/ui';
import { ContactAutocomplete } from '@/components/contact-autocomplete';
import { NatureSelect } from '@/components/nature-select';

function PayableForm({ initial, current, companies, brands, categories, onSubmit, onCancel }: {
  initial?: Partial<AccountPayable>;
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
    supplier_name: initial?.supplier_name ?? '',
    supplier_doc: initial?.supplier_doc ?? '',
    document_number: initial?.document_number ?? '',
    amount: initial?.amount ? formatBRLInput(parseInt(String(initial.amount))) : '',
    issue_date: initial?.issue_date ? new Date(initial.issue_date).toISOString().slice(0, 10) : todayInput(),
    due_date: initial?.due_date ? new Date(initial.due_date).toISOString().slice(0, 10) : todayInput(),
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    brand_id: initial?.brand_id ?? '',
    category_id: initial?.category_id ?? '',
    nature_id: (initial as any)?.nature_id ?? '',
    account_id: (initial as any)?.account_id ?? '',
    notes: initial?.notes ?? '',
    is_deductible_expense: initial?.is_deductible_expense ?? true,
    generates_pis_cofins_credit: initial?.generates_pis_cofins_credit ?? false,
    is_service_from_pj: (initial as any)?.is_service_from_pj ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;
  const filteredBrands = brands.filter(b => b.company_id === data.company_id);
  const expenseCategories = categories.filter(c => c.company_id === data.company_id && c.type === 'EXPENSE');

  // Carrega o plano de contas analítico (folhas) da empresa selecionada
  useEffect(() => {
    if (!data.company_id) { setAccounts([]); return; }
    api.get('/financial/chart-of-accounts', {
      params: { company_id: data.company_id, page: 1 },
    }).then(r => {
      const all: ChartOfAccount[] = r.data.data ?? [];
      // Mantém apenas contas analíticas (sem filhas) para evitar lançar em sintéticas
      const codeSet = new Set(all.map(a => a.code));
      const isLeaf = (a: ChartOfAccount) =>
        !all.some(b => b.code !== a.code && b.code.startsWith(a.code + '.'));
      const expenses = all
        .filter(a => a.type === 'EXPENSE' && a.is_active && isLeaf(a))
        .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR'));
      setAccounts(expenses);
    }).catch(() => setAccounts([]));
  }, [data.company_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.description.trim() || data.description.length < 2) errs.description = 'Descrição obrigatória';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    if (!data.contact_id && (!data.supplier_name || data.supplier_name.length < 2)) errs.supplier = 'Selecione um fornecedor ou digite o nome';
    if (!data.amount || parseInputToCents(data.amount) < 1) errs.amount = 'Valor obrigatório';
    if (!data.issue_date) errs.issue_date = 'Data de emissão obrigatória';
    if (!data.due_date) errs.due_date = 'Vencimento obrigatório';
    if (!isEdit && !data.nature_id && !data.account_id) errs.nature_id = 'Selecione natureza contábil ou plano de contas';
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
          account_id: data.account_id || undefined,
          is_deductible_expense: data.is_deductible_expense,
          generates_pis_cofins_credit: data.generates_pis_cofins_credit,
          is_service_from_pj: data.is_service_from_pj,
        };
        if (data.contact_id) {
          payload.contact_id = data.contact_id;
        } else {
          payload.supplier_name = data.supplier_name;
          payload.supplier_doc = data.supplier_doc || undefined;
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
      {/* === LINHA 1: Empresa (se for create) === */}
      {!isEdit && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id} onChange={e => setData({ ...data, company_id: e.target.value, brand_id: '', category_id: '', nature_id: '', account_id: '' })}
            disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}

      {/* === LINHA 2: Descrição === */}
      <Field label="Descrição" required error={errors.description}>
        <Input value={data.description} onChange={e => setData({ ...data, description: e.target.value })}
          placeholder="Ex: Aluguel março/2026" />
      </Field>

      {/* === LINHA 3: Fornecedor + Natureza lado a lado === */}
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Fornecedor" required error={errors.supplier}>
          <ContactAutocomplete
            companyId={data.company_id}
            role="supplier"
            value={data.contact_id}
            onChange={(contact) => {
              if (contact) {
                setData({ ...data, contact_id: contact.id, supplier_name: contact.name, supplier_doc: contact.document ?? '' });
              } else {
                setData({ ...data, contact_id: '', supplier_name: '', supplier_doc: '' });
              }
            }}
            placeholder="Buscar fornecedor..."
          />
        </Field>

        <Field label={
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-700" />
            Natureza Contábil (DRE){data.account_id ? <span className="text-[10px] text-stone-500 ml-1">— auto</span> : null}
          </span>
        } required={!data.account_id} error={errors.nature_id}>
          <NatureSelect
            companyId={data.company_id}
            type="DESPESA"
            value={data.nature_id || null}
            onChange={(natureId) => setData({ ...data, nature_id: natureId ?? '' })}
            required={!data.account_id}
          />
          {data.account_id && !data.nature_id && (
            <div className="text-[10px] text-emerald-700 mt-1">
              ✓ Será derivada automaticamente do plano de contas selecionado.
            </div>
          )}
        </Field>
      </div>

      {/* Fornecedor manual quando não há contact_id */}
      {!data.contact_id && (
        <div className="grid grid-cols-2 gap-3 pl-3 border-l-2 border-stone-200">
          <Input value={data.supplier_name} onChange={e => setData({ ...data, supplier_name: e.target.value })}
            placeholder="Nome do fornecedor" />
          <Input value={data.supplier_doc} onChange={e => setData({ ...data, supplier_doc: e.target.value })}
            placeholder="CNPJ/CPF (opcional)" />
        </div>
      )}

      {/* === LINHA 4: Valor + Documento === */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)" required error={errors.amount}>
          <Input value={data.amount} onChange={e => setData({ ...data, amount: e.target.value })} placeholder="0,00" />
        </Field>
        <Field label="Documento (NF/Boleto)">
          <Input value={data.document_number} onChange={e => setData({ ...data, document_number: e.target.value })} placeholder="000123" />
        </Field>
      </div>

      {/* === LINHA 5: Datas === */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emissão" required error={errors.issue_date}>
          <Input type="date" value={data.issue_date} onChange={e => setData({ ...data, issue_date: e.target.value })} />
        </Field>
        <Field label="Vencimento" required error={errors.due_date}>
          <Input type="date" value={data.due_date} onChange={e => setData({ ...data, due_date: e.target.value })} />
        </Field>
      </div>

      {/* === Bloco "Avançado" colapsável === */}
      <div className="border border-stone-200 rounded-sm">
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-3 py-2 text-xs uppercase tracking-wider text-stone-600 flex items-center justify-between hover:bg-stone-50">
          <span>Opções avançadas (marca, categoria, tributário, observações)</span>
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
                <Select value={data.category_id} onChange={e => {
                  const newCatId = e.target.value;
                  const cat = expenseCategories.find(c => c.id === newCatId);
                  // Auto-preenche a Natureza se a categoria tiver natureza padrão e o campo Natureza estiver vazio
                  const updates: any = { category_id: newCatId };
                  if (cat?.default_nature_id && !data.nature_id) {
                    updates.nature_id = cat.default_nature_id;
                  }
                  setData({ ...data, ...updates });
                }}>
                  <option value="">Nenhuma</option>
                  {expenseCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Plano de Contas (despesa contábil)">
              <Select value={data.account_id} onChange={e => setData({ ...data, account_id: e.target.value })}>
                <option value="">— Sem conta contábil —</option>
                {accounts.length === 0 && data.company_id && (
                  <option value="" disabled>Empresa sem plano de contas — configure em Configurações → Plano de Contas</option>
                )}
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                ))}
              </Select>
              <div className="text-[10px] text-stone-500 mt-1">
                Conta analítica do plano de contas onde esta despesa será classificada. Quando importada de NF, é preenchida automaticamente.
              </div>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-start gap-2 p-2.5 bg-white border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
                <input type="checkbox" checked={data.is_deductible_expense}
                  onChange={e => setData({ ...data, is_deductible_expense: e.target.checked })} className="mt-0.5" />
                <div>
                  <div className="text-xs font-medium">Despesa dedutível IRPJ/CSLL</div>
                  <div className="text-[10px] text-stone-600">Entra na base de cálculo do Lucro Real</div>
                </div>
              </label>

              <label className="flex items-start gap-2 p-2.5 bg-white border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
                <input type="checkbox" checked={data.generates_pis_cofins_credit}
                  onChange={e => setData({ ...data, generates_pis_cofins_credit: e.target.checked })} className="mt-0.5" />
                <div>
                  <div className="text-xs font-medium">Gera crédito PIS/COFINS</div>
                  <div className="text-[10px] text-stone-600">No regime não-cumulativo</div>
                </div>
              </label>
            </div>

            {/* === Retenções federais (CSRF) — serviços tomados de PJ === */}
            <label className="flex items-start gap-2 p-2.5 bg-white border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
              <input type="checkbox" checked={data.is_service_from_pj}
                onChange={e => setData({ ...data, is_service_from_pj: e.target.checked })} className="mt-0.5" />
              <div>
                <div className="text-xs font-medium">Serviço tomado de PJ — aplicar retenções federais</div>
                <div className="text-[10px] text-stone-600">CSRF: IRRF 1,5% + CSLL 1,0% + PIS 0,65% + COFINS 3,0% (total 6,15%)</div>
              </div>
            </label>

            {data.is_service_from_pj && (() => {
              const grossCents = parseInputToCents(data.amount) || 0;
              const irrf   = Math.round(grossCents * 0.015);
              const csll   = Math.round(grossCents * 0.010);
              const pis    = Math.round(grossCents * 0.0065);
              const cofins = Math.round(grossCents * 0.030);
              const totalRet = irrf + csll + pis + cofins;
              const liquido = grossCents - totalRet;
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 text-xs">
                  <div className="font-medium text-amber-900 mb-2 uppercase tracking-wider text-[10px]">Preview das retenções</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div><div className="text-stone-500 text-[10px]">IRRF (1,5%)</div><div className="font-mono">{formatBRL(irrf)}</div></div>
                    <div><div className="text-stone-500 text-[10px]">CSLL (1,0%)</div><div className="font-mono">{formatBRL(csll)}</div></div>
                    <div><div className="text-stone-500 text-[10px]">PIS (0,65%)</div><div className="font-mono">{formatBRL(pis)}</div></div>
                    <div><div className="text-stone-500 text-[10px]">COFINS (3,0%)</div><div className="font-mono">{formatBRL(cofins)}</div></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-amber-200">
                    <div><div className="text-stone-500 text-[10px]">Bruto (NF)</div><div className="font-mono">{formatBRL(grossCents)}</div></div>
                    <div><div className="text-stone-500 text-[10px]">(−) Retido</div><div className="font-mono text-red-700">−{formatBRL(totalRet)}</div></div>
                    <div><div className="text-stone-500 text-[10px]">Líquido a pagar</div><div className="font-mono font-medium text-emerald-700">{formatBRL(liquido)}</div></div>
                  </div>
                </div>
              );
            })()}

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

function PayModal({ payable, accounts, onSubmit, onCancel }: {
  payable: AccountPayable;
  accounts: BankAccount[];
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const totalRetained =
    Number((payable as any).irrf_retained ?? 0) +
    Number((payable as any).csll_retained ?? 0) +
    Number((payable as any).pis_retained ?? 0) +
    Number((payable as any).cofins_retained ?? 0);
  const netAmount = Number(payable.amount) - totalRetained;
  const [paidAmount, setPaidAmount] = useState(formatBRLInput(netAmount));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!accountId) { setError('Selecione a conta bancária'); return; }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        bank_account_id: accountId,
        payment_date: paymentDate,
        paid_amount: parseInputToCents(paidAmount),
      });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao confirmar pagamento.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm">
        <div className="font-medium">{payable.description}</div>
        <div className="text-stone-600 text-xs mt-1">Total: {formatBRL(payable.amount)} · Vencimento: {formatDate(payable.due_date)}</div>
        {totalRetained > 0 && (
          <div className="mt-2 pt-2 border-t border-stone-200 text-xs grid grid-cols-3 gap-2">
            <div>Bruto: <span className="font-mono">{formatBRL(payable.amount)}</span></div>
            <div>(−) Retido CSRF: <span className="font-mono text-red-700">−{formatBRL(totalRetained)}</span></div>
            <div>Líquido: <span className="font-mono font-medium text-emerald-700">{formatBRL(netAmount)}</span></div>
          </div>
        )}
      </div>
      <Field label="Conta bancária" required>
        <Select value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (saldo: {formatBRL(a.current_balance)})</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data do pagamento" required>
          <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
        </Field>
        <Field label="Valor pago">
          <Input value={paidAmount} onChange={e => setPaidAmount(e.target.value)} />
        </Field>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Processando...' : 'Confirmar pagamento'}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function AccountsPayablePage() {
  const { user } = useAuth();
  const [items, setItems] = useState<AccountPayable[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | 'pay' | null; data?: AccountPayable }>({ type: null });
  const [dupAlert, setDupAlert] = useState<{ existing: AccountPayable; pendingPayload: any } | null>(null);

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
    const res = await api.get('/financial/accounts-payable', { params: { ...filters, page } });
    setItems(res.data.data);
    setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);

  const handleSave = async (data: any) => {
    if (modal.data?.id) {
      await api.patch(`/financial/accounts-payable/${modal.data.id}`, data);
      setModal({ type: null });
      await reload();
      return;
    }
    try {
      await api.post('/financial/accounts-payable', data);
      setModal({ type: null });
      await reload();
    } catch (err: any) {
      const body = err?.response?.data?.message;
      if (body && typeof body === 'object' && body.code === 'DUPLICATE_DETECTED' && body.existing) {
        setDupAlert({ existing: body.existing, pendingPayload: data });
        return;
      }
      throw err;
    }
  };

  const forceCreateDuplicate = async () => {
    if (!dupAlert) return;
    await api.post('/financial/accounts-payable', { ...dupAlert.pendingPayload, force_duplicate: true });
    setDupAlert(null);
    setModal({ type: null });
    await reload();
  };

  const editExistingDuplicate = () => {
    if (!dupAlert) return;
    const existing = dupAlert.existing;
    setDupAlert(null);
    setModal({ type: 'edit', data: existing });
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/financial/accounts-payable/${modal.data.id}`);
    setModal({ type: null });
    await reload();
  };

  const handlePay = async (data: any) => {
    if (!modal.data) return;
    await api.post(`/financial/accounts-payable/${modal.data.id}/pay`, data);
    setModal({ type: null });
    await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Contas a Pagar"
        subtitle='Lance a despesa, depois clique em "Pagar" para gerar o lançamento bancário. A transação criada aparece em Conciliação para bater com o extrato.'
        action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova conta a pagar" />}
      />

      <FilterBar
        filters={[
          { key: 'description', label: 'Descrição', placeholder: 'Buscar...' },
          { key: 'supplier_name', label: 'Fornecedor', placeholder: 'Buscar...' },
          { key: 'company_id', label: 'Empresa', type: 'select', options: companies.map(c => ({ value: c.id, label: c.name })) },
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'PENDING', label: 'Pendente' },
            { value: 'PAID', label: 'Paga' },
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
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Fornecedor</th>
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
              {items.map(p => {
                const nature = (p as any).nature as FinancialNature | undefined;
                return (
                  <tr key={p.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.description}</div>
                      {p.document_number && <div className="text-xs text-stone-500 mt-0.5"><Receipt className="w-3 h-3 inline mr-1" />{p.document_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{p.supplier_name || '—'}</div>
                      {p.supplier_doc && <div className="text-xs text-stone-500 font-mono">{formatDocument(p.supplier_doc)}</div>}
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
                    <td className="px-4 py-3 text-right font-mono">
                      {formatBRL(p.amount)}
                      {(p as any).is_service_from_pj && (() => {
                        const ret = Number((p as any).irrf_retained ?? 0)
                          + Number((p as any).csll_retained ?? 0)
                          + Number((p as any).pis_retained ?? 0)
                          + Number((p as any).cofins_retained ?? 0);
                        if (ret === 0) return null;
                        const liq = Number(p.amount) - ret;
                        return (
                          <div className="text-[10px] text-stone-500 mt-0.5" title={`Retido: ${formatBRL(ret)} (CSRF)`}>
                            líq. <span className="text-emerald-700 font-medium">{formatBRL(liq)}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-stone-700"><Calendar className="w-3.5 h-3.5 inline mr-1 text-stone-400" />{formatDate(p.due_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {p.status !== 'PAID' && p.status !== 'CANCELLED' && (
                        <button onClick={() => setModal({ type: 'pay', data: p })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-sm transition mr-1"
                          title="Marcar como paga (gera lançamento bancário)">
                          <DollarSign className="w-3.5 h-3.5" /> Pagar
                        </button>
                      )}
                      {p.status === 'PAID' && (
                        <Link href="/dashboard/financial/reconciliation"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-sm transition mr-1"
                          title="Conciliar com extrato bancário">
                          <ScanLine className="w-3.5 h-3.5" /> Conciliar
                        </Link>
                      )}
                      <button onClick={() => setModal({ type: 'edit', data: p })}
                        className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm" title="Editar"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => setModal({ type: 'delete', data: p })}
                        className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1" title="Excluir"><Trash2 className="w-4 h-4" /></button>
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
        title={modal.type === 'create' ? 'Nova conta a pagar' : 'Editar conta'} size="lg">
        {user && <PayableForm initial={modal.data} current={user} companies={companies}
          brands={brands} categories={categories} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />}
      </Modal>

      <Modal open={modal.type === 'pay'} onClose={() => setModal({ type: null })} title="Confirmar pagamento" size="md">
        {modal.data && <PayModal payable={modal.data} accounts={accounts.filter(a => a.company_id === modal.data?.company_id)}
          onSubmit={handlePay} onCancel={() => setModal({ type: null })} />}
      </Modal>

      <Modal open={!!dupAlert} onClose={() => setDupAlert(null)} title="Possível lançamento duplicado" size="md">
        {dupAlert && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-300 rounded-sm p-3 text-sm text-amber-900">
              ⚠️ Já existe uma conta a pagar similar no sistema. Verifique antes de continuar.
            </div>
            <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm">
              <div className="font-medium">{dupAlert.existing.description}</div>
              <div className="text-xs text-stone-600 mt-1">
                Fornecedor: {dupAlert.existing.supplier_name || '—'}
                {dupAlert.existing.supplier_doc && ` · ${formatDocument(dupAlert.existing.supplier_doc)}`}
              </div>
              <div className="text-xs text-stone-600">
                Valor: {formatBRL(dupAlert.existing.amount)} · Emissão: {formatDate(dupAlert.existing.issue_date)}
                {dupAlert.existing.document_number && ` · Doc: ${dupAlert.existing.document_number}`}
              </div>
              {(dupAlert.existing as any).source && (
                <div className="text-xs text-stone-500 mt-1 uppercase tracking-wider">Origem: {(dupAlert.existing as any).source}</div>
              )}
            </div>
            <div className="flex flex-col gap-2 pt-2 border-t border-stone-200">
              <PrimaryButton type="button" onClick={editExistingDuplicate}>Editar a existente</PrimaryButton>
              <SecondaryButton type="button" onClick={forceCreateDuplicate}>Criar mesmo assim (marcar como duplicada)</SecondaryButton>
              <SecondaryButton type="button" onClick={() => setDupAlert(null)}>Cancelar</SecondaryButton>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })}
        onConfirm={handleDelete}
        entityName={modal.data?.description}
        entityLabel="a conta a pagar" />
    </div>
  );
}
