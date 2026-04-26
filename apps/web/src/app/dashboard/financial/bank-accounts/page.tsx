'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Landmark, Edit2, Trash2, Zap, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { BankAccount, Company, BankAccountType } from '@/lib/types';
import { bankAccountTypeLabels, formatBRL } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, ConfirmDeleteModal, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton } from '@/components/ui';
import { CurrencyInput, MoneyText } from '@/components/financial-ui';

function BankAccountForm({ initial, onSubmit, onCancel, current, companies }: { initial?: Partial<BankAccount>; onSubmit: (data: any) => Promise<void>; onCancel: () => void; current: any; companies: Company[] }) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    name: initial?.name ?? '',
    type: (initial?.type ?? 'CHECKING') as BankAccountType,
    bank_name: initial?.bank_name ?? '',
    bank_code: initial?.bank_code ?? '',
    agency: initial?.agency ?? '',
    account_number: initial?.account_number ?? '',
    initial_balance: initial?.initial_balance ? Number(initial.initial_balance) : 0,
    description: initial?.description ?? '',
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
    is_active: initial?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = { name: data.name, type: data.type };
        if (data.bank_name) payload.bank_name = data.bank_name;
        if (data.bank_code) payload.bank_code = data.bank_code;
        if (data.agency) payload.agency = data.agency;
        if (data.account_number) payload.account_number = data.account_number;
        if (data.description) payload.description = data.description;
        if (isEdit) payload.is_active = data.is_active;
        if (!isEdit) {
          payload.company_id = data.company_id;
          payload.initial_balance = data.initial_balance;
        }
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Ex: Itaú CC Principal" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo" required>
          <Select value={data.type} onChange={e => setData({ ...data, type: e.target.value as BankAccountType })}>
            {Object.entries(bankAccountTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Banco">
          <Input value={data.bank_name ?? ''} onChange={e => setData({ ...data, bank_name: e.target.value })} placeholder="Itaú, Bradesco, Pagar.me..." />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Código">
          <Input value={data.bank_code ?? ''} onChange={e => setData({ ...data, bank_code: e.target.value })} placeholder="341" />
        </Field>
        <Field label="Agência">
          <Input value={data.agency ?? ''} onChange={e => setData({ ...data, agency: e.target.value })} />
        </Field>
        <Field label="Número da conta">
          <Input value={data.account_number ?? ''} onChange={e => setData({ ...data, account_number: e.target.value })} />
        </Field>
      </div>
      {!isEdit && (
        <>
          <Field label="Empresa" required error={errors.company_id}>
            <Select value={data.company_id ?? ''} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
              <option value="">Selecione...</option>
              {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Saldo inicial">
            <CurrencyInput value={data.initial_balance} onChange={v => setData({ ...data, initial_balance: v })} />
            <div className="text-xs text-stone-500 mt-1">Valor atual da conta no momento do cadastro.</div>
          </Field>
        </>
      )}
      {isEdit && (
        <label className="flex items-start gap-3 p-3 border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
          <input type="checkbox" checked={data.is_active}
            onChange={e => setData({ ...data, is_active: e.target.checked })} className="mt-1" />
          <div>
            <div className="text-sm font-medium">Conta ativa</div>
            <div className="text-xs text-stone-600">Contas inativas não aparecem em formulários de pagamento/recebimento. Útil para contas auto-importadas via Pluggy que ainda não foram revisadas.</div>
          </div>
        </label>
      )}

      <Field label="Observações">
        <textarea value={data.description ?? ''} onChange={e => setData({ ...data, description: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={300} />
      </Field>
      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar conta'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function BankAccountsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<BankAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: BankAccount }>({ type: null });

  const reload = async () => {
    const res = await api.get('/financial/bank-accounts', { params: { ...filters, page } });
    setItems(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {}); }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/financial/bank-accounts/${modal.data.id}`, data);
    else await api.post('/financial/bank-accounts', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    try {
      await api.delete(`/financial/bank-accounts/${modal.data.id}`);
      setModal({ type: null }); await reload();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro ao excluir');
    }
  };

  const totalBalance = items.reduce((s, a) => s + Number(a.current_balance), 0);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader title="Contas Bancárias" subtitle="Financeiro · Contas e gateways" action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova conta" />} />

      {items.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Saldo total consolidado</div>
            <div className="font-display text-3xl text-ink"><MoneyText cents={totalBalance} /></div>
          </div>
          <Landmark className="w-10 h-10 text-gold" strokeWidth={1.2} />
        </div>
      )}

      <FilterBar
        filters={[
          { key: 'name', label: 'Nome' },
          { key: 'type', label: 'Tipo', type: 'select', options: Object.entries(bankAccountTypeLabels).map(([v, l]) => ({ value: v, label: l })) },
        ]}
        values={filters} onChange={setFilters}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Banco</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Saldo atual</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-stone-500">Nenhuma conta cadastrada.</td></tr>}
              {items.map(a => {
                const conn = a.bank_connection;
                const connOk = conn && conn.status === 'ACTIVE';
                const connWarn = conn && (conn.status === 'OUTDATED' || conn.status === 'WAITING_USER_INPUT' || conn.status === 'LOGIN_ERROR');
                return (
                <tr key={a.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Landmark className="w-5 h-5 text-gold" strokeWidth={1.5} />
                      <div>
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {a.name}
                          {!a.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-stone-100 text-stone-600 border border-stone-300 uppercase tracking-wider">Inativa</span>}
                          {connOk && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-sky-50 text-sky-700 border border-sky-200 uppercase tracking-wider inline-flex items-center gap-1"><Zap className="w-3 h-3" /> Auto-sync</span>}
                          {connWarn && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Reconectar</span>}
                        </div>
                        {a.account_number && <div className="text-xs text-stone-500">Ag. {a.agency} · CC {a.account_number}</div>}
                        {conn && (
                          <div className="text-[11px] text-stone-500 mt-0.5">
                            🔗 <Link href="/dashboard/bank-integrations" className="hover:text-ink underline">{conn.institution_name ?? 'Integração'}</Link>
                            {conn.last_sync_at && <span> · sync {new Date(conn.last_sync_at).toLocaleString('pt-BR')}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-700">{bankAccountTypeLabels[a.type]}</td>
                  <td className="px-4 py-3 text-stone-700">{a.bank_name || '—'}</td>
                  <td className="px-4 py-3 text-right"><MoneyText cents={a.current_balance} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setModal({ type: 'edit', data: a })} className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => setModal({ type: 'delete', data: a })} className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
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
        <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })} title={modal.type === 'create' ? 'Nova conta bancária' : 'Editar conta bancária'} size="lg">
          <BankAccountForm initial={modal.data} current={user} companies={companies} onSubmit={handleSave} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.name} entityLabel="a conta" />
    </div>
  );
}
