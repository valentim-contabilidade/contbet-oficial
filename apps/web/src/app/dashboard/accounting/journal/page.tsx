'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Plus, Trash2, Edit2, RefreshCw, Calendar, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, todayInput } from '@/lib/format';
import {
  PageHeader, Pagination, Modal, ConfirmDeleteModal,
  Field, Input, Select, PrimaryButton, SecondaryButton, NewButton,
} from '@/components/ui';
import { CurrencyInput } from '@/components/financial-ui';
import type { Company } from '@/lib/types';

interface ChartAccount {
  id: string; code: string; name: string; type: string; is_active: boolean;
}
interface Line {
  account_id: string;
  description?: string;
  debit_amount?: number;
  credit_amount?: number;
}
interface Entry {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  source: string;
  source_id: string | null;
  total_amount: string;
  posted: boolean;
  company_id: string;
  brand_id: string | null;
  lines: Array<{
    id: string; debit_amount: string; credit_amount: string; description: string | null;
    account: { id: string; code: string; name: string; type: string };
  }>;
}

const sourceLabels: Record<string, string> = {
  MANUAL: 'Manual', GGR_DAILY: 'GGR diário', PAYABLE_PAID: 'Pagamento',
  RECEIVABLE_RECEIVED: 'Recebimento', TAX_APURATION: 'Apuração tributária',
  PAYROLL: 'Folha', ADJUSTMENT: 'Ajuste',
};

function EntryForm({ initial, accounts, companies, current, onSubmit, onCancel }: {
  initial?: Partial<Entry>;
  accounts: ChartAccount[];
  companies: Company[];
  current: any;
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = !!initial?.id;
  const [date, setDate] = useState(initial?.date ? new Date(initial.date).toISOString().slice(0, 10) : todayInput());
  const [description, setDescription] = useState(initial?.description ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [companyId, setCompanyId] = useState(initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''));
  const [lines, setLines] = useState<Line[]>(
    initial?.lines?.length
      ? initial.lines.map(l => ({
          account_id: l.account.id,
          description: l.description ?? undefined,
          debit_amount: Number(l.debit_amount),
          credit_amount: Number(l.credit_amount),
        }))
      : [{ account_id: '', debit_amount: 0, credit_amount: 0 }, { account_id: '', debit_amount: 0, credit_amount: 0 }]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const filteredAccounts = accounts.filter(a => a.is_active);
  const totalDebit = lines.reduce((s, l) => s + (l.debit_amount ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit_amount ?? 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const submit = async () => {
    setError('');
    if (!description.trim()) { setError('Descrição obrigatória.'); return; }
    if (!companyId) { setError('Selecione a empresa.'); return; }
    if (!balanced) { setError(`Lançamento desbalanceado: D ${formatBRL(totalDebit)} ≠ C ${formatBRL(totalCredit)}.`); return; }
    if (lines.some(l => !l.account_id)) { setError('Todas as partidas precisam de uma conta selecionada.'); return; }
    setSubmitting(true);
    try {
      const payload: any = {
        date,
        description,
        reference: reference || undefined,
        lines: lines.map(l => ({
          account_id: l.account_id,
          description: l.description || undefined,
          debit_amount: l.debit_amount && l.debit_amount > 0 ? l.debit_amount : undefined,
          credit_amount: l.credit_amount && l.credit_amount > 0 ? l.credit_amount : undefined,
        })),
      };
      if (!isEdit) payload.company_id = companyId;
      await onSubmit(payload);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao salvar.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      {!isEdit && (
        <Field label="Empresa" required>
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Data" required>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <Field label="Documento / Referência">
          <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Ex: NF 1234" />
        </Field>
      </div>

      <Field label="Histórico" required>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]"
          placeholder="Ex: Pagamento de fornecedor X conforme NF 1234" />
      </Field>

      <div className="border border-stone-200 rounded-sm overflow-hidden">
        <div className="bg-stone-50 px-3 py-2 text-xs uppercase tracking-wider text-stone-700 font-medium flex items-center justify-between">
          <span>Partidas (D/C)</span>
          <button type="button" onClick={() => setLines([...lines, { account_id: '', debit_amount: 0, credit_amount: 0 }])}
            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900">
            <Plus className="w-3 h-3" /> Nova partida
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-stone-600">Conta</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-stone-600 w-32">Débito</th>
              <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-stone-600 w-32">Crédito</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx} className="border-b border-stone-100">
                <td className="px-3 py-2">
                  <Select value={l.account_id} onChange={e => {
                    const next = [...lines]; next[idx] = { ...l, account_id: e.target.value }; setLines(next);
                  }}>
                    <option value="">Selecione a conta...</option>
                    {filteredAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <CurrencyInput value={l.debit_amount ?? 0} onChange={v => {
                    const next = [...lines]; next[idx] = { ...l, debit_amount: v, credit_amount: v > 0 ? 0 : l.credit_amount };
                    setLines(next);
                  }} />
                </td>
                <td className="px-3 py-2">
                  <CurrencyInput value={l.credit_amount ?? 0} onChange={v => {
                    const next = [...lines]; next[idx] = { ...l, credit_amount: v, debit_amount: v > 0 ? 0 : l.debit_amount };
                    setLines(next);
                  }} />
                </td>
                <td className="px-3 py-2 text-center">
                  {lines.length > 2 && (
                    <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                      className="p-1 text-stone-500 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-stone-50 border-t-2 border-stone-300">
            <tr>
              <td className="px-3 py-2 text-xs uppercase tracking-wider text-stone-700 text-right">Totais</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{formatBRL(totalDebit)}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{formatBRL(totalCredit)}</td>
              <td className="px-3 py-2 text-center">
                {balanced ? <span className="text-green-700 text-xs">✓</span> : <span className="text-red-700 text-xs">⚠</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !balanced}>
          {submitting ? 'Salvando...' : 'Salvar lançamento'}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function JournalPage() {
  const { user } = useAuth();
  const today = new Date();
  const monthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = todayInput();

  const [items, setItems] = useState<Entry[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({
    from: monthStart,
    to: monthEnd,
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: Entry }>({ type: null });
  const [syncMsg, setSyncMsg] = useState('');

  const reload = async () => {
    const res = await api.get('/accounting/journal', { params: { ...filters, page } });
    setItems(res.data.data);
    setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => {
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
    api.get('/financial/chart-of-accounts').then(r => setAccounts(r.data.data)).catch(() => {});
  }, []);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/accounting/journal/${modal.data.id}`, data);
    else await api.post('/accounting/journal', data);
    setModal({ type: null });
    await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/accounting/journal/${modal.data.id}`);
    setModal({ type: null });
    await reload();
  };

  const handleReprocess = async () => {
    const companyId = filters.company_id || (user?.profile === 'MANAGER' ? user.company_id : companies[0]?.id);
    if (!companyId) { alert('Selecione uma empresa.'); return; }
    if (!filters.from || !filters.to) { alert('Defina o período (De / Até).'); return; }
    if (!confirm(`Reprocessar contabilização do período ${filters.from} → ${filters.to}? Vai gerar ou atualizar os lançamentos a partir dos eventos (GGR, pagamentos, recebimentos, apurações).`)) return;
    setSyncMsg('Reprocessando…');
    try {
      const res = await api.post('/accounting/reprocess', { company_id: companyId, from: filters.from, to: filters.to });
      const r = res.data;
      const errs = r.errors?.length ? ` · ⚠ ${r.errors.length} erro(s) — ver console` : '';
      setSyncMsg(`✓ GGR: ${r.ggr} · Pagamentos: ${r.payables} · Recebimentos: ${r.receivables} · Tributos: ${r.taxes}${errs}`);
      if (r.errors?.length) console.warn('Reprocess errors:', r.errors);
      await reload();
    } catch (err: any) {
      setSyncMsg(err?.response?.data?.message ?? 'Erro ao reprocessar.');
    }
  };

  const handleSyncDefaults = async () => {
    const companyId = filters.company_id || (user?.profile === 'MANAGER' ? user.company_id : companies[0]?.id);
    if (!companyId) { alert('Selecione uma empresa.'); return; }
    setSyncMsg('Sincronizando…');
    try {
      const res = await api.post(`/financial/chart-of-accounts/sync-defaults/${companyId}`);
      setSyncMsg(`✓ ${res.data.created} conta(s) criada(s), ${res.data.skipped} já existiam.`);
      const r = await api.get('/financial/chart-of-accounts');
      setAccounts(r.data.data);
      setTimeout(() => setSyncMsg(''), 4000);
    } catch (err: any) {
      setSyncMsg(err?.response?.data?.message ?? 'Erro ao sincronizar.');
    }
  };

  if (user?.profile !== 'ADMIN') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Apenas administradores têm acesso ao livro de lançamentos contábeis.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Lançamentos contábeis"
        subtitle="Diário · partidas dobradas (débito/crédito) por evento"
        action={
          <div className="flex gap-2 flex-wrap">
            <SecondaryButton onClick={handleSyncDefaults}>
              <RefreshCw className="w-4 h-4 inline mr-2" /> Sincronizar plano
            </SecondaryButton>
            <SecondaryButton onClick={handleReprocess}>
              <Zap className="w-4 h-4 inline mr-2" /> Reprocessar período
            </SecondaryButton>
            <NewButton onClick={() => setModal({ type: 'create' })} label="Novo lançamento" />
          </div>
        }
      />

      {syncMsg && <div className="bg-blue-50 border border-blue-200 rounded-sm px-3 py-2 mb-4 text-xs text-blue-800">{syncMsg}</div>}

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-4 gap-3">
        <Field label="Empresa">
          <Select value={filters.company_id ?? ''} onChange={e => setFilters({ ...filters, company_id: e.target.value })}>
            <option value="">Todas</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Origem">
          <Select value={filters.source ?? ''} onChange={e => setFilters({ ...filters, source: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(sourceLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="De">
          <Input type="date" value={filters.from ?? ''} onChange={e => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label="Até">
          <Input type="date" value={filters.to ?? ''} onChange={e => setFilters({ ...filters, to: e.target.value })} />
        </Field>
      </div>

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Data</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Histórico</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Origem</th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Valor</th>
              <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-stone-500">
                <BookOpenCheck className="w-10 h-10 mx-auto text-stone-300 mb-3" strokeWidth={1.2} />
                Nenhum lançamento ainda.
              </td></tr>
            )}
            {items.map(e => (
              <>
                <tr key={e.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3"><Calendar className="w-3.5 h-3.5 inline mr-1 text-stone-400" />{formatDate(e.date)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.description}</div>
                    {e.reference && <div className="text-xs text-stone-500 mt-0.5">{e.reference}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider bg-stone-100 text-stone-700">
                      {sourceLabels[e.source] ?? e.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatBRL(e.total_amount)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {e.source === 'MANUAL' && (
                      <>
                        <button onClick={() => setModal({ type: 'edit', data: e })}
                          className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm" title="Editar"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => setModal({ type: 'delete', data: e })}
                          className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1" title="Excluir"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                  </td>
                </tr>
                <tr key={`${e.id}-lines`} className="border-b border-stone-100 bg-stone-50/50">
                  <td colSpan={5} className="px-8 py-2">
                    <table className="w-full text-xs">
                      <tbody>
                        {e.lines.map(l => (
                          <tr key={l.id}>
                            <td className="py-1 font-mono text-stone-500 w-32">{l.account.code}</td>
                            <td className="py-1">{l.account.name}</td>
                            <td className="py-1 text-right font-mono w-32">{Number(l.debit_amount) > 0 ? `D ${formatBRL(l.debit_amount)}` : ''}</td>
                            <td className="py-1 text-right font-mono w-32">{Number(l.credit_amount) > 0 ? `C ${formatBRL(l.credit_amount)}` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })}
        title={modal.type === 'create' ? 'Novo lançamento contábil' : 'Editar lançamento'} size="lg">
        {user && <EntryForm initial={modal.data} accounts={accounts} companies={companies} current={user}
          onSubmit={handleSave} onCancel={() => setModal({ type: null })} />}
      </Modal>

      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })}
        onConfirm={handleDelete} entityName={modal.data?.description} entityLabel="o lançamento" />
    </div>
  );
}
