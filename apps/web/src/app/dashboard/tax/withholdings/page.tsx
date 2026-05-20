'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, AlertTriangle, ShieldCheck, Calendar, FileText, DollarSign } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, monthNames, formatBRLInput, parseInputToCents, todayInput } from '@/lib/format';
import { PageHeader, FilterBar, Modal, Field, Select, Input, PrimaryButton, SecondaryButton } from '@/components/ui';
import type { Company, BankAccount } from '@/lib/types';

type TributoKey = 'irrf' | 'csll' | 'pis' | 'cofins';
type DarfStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'CANCELLED' | null;

interface BreakdownItem {
  tributo: TributoKey;
  retained: string;
  darf_amount: string;
  paid_amount: string;
  darf_status: DarfStatus;
  darf_payable_id: string | null;
  darf_due_date: string | null;
  diff_retained_darf: string;
  alert: 'MISSING_DARF' | 'OVER_DARF' | null;
}

interface WithholdingGroup {
  company_id: string;
  company_name: string;
  year: number;
  month: number;
  total_retained: string;
  total_darf: string;
  total_paid: string;
  breakdown: BreakdownItem[];
  has_alert: boolean;
}

const tributoLabels: Record<TributoKey, { label: string; rate: string; codigo: string; color: string }> = {
  irrf:   { label: 'IRRF',   rate: '1,5%',  codigo: '1708', color: 'text-amber-800' },
  csll:   { label: 'CSLL',   rate: '1,0%',  codigo: '5987', color: 'text-purple-800' },
  pis:    { label: 'PIS',    rate: '0,65%', codigo: '5979', color: 'text-sky-800' },
  cofins: { label: 'COFINS', rate: '3,0%',  codigo: '5960', color: 'text-rose-800' },
};

const statusBadge = (s: DarfStatus) => {
  if (!s) return <span className="text-stone-400 text-xs">—</span>;
  const map: Record<string, { bg: string; text: string; label: string }> = {
    PAID:      { bg: 'bg-green-50',  text: 'text-green-800',  label: 'Pago' },
    PENDING:   { bg: 'bg-amber-50',  text: 'text-amber-800',  label: 'Pendente' },
    PARTIAL:   { bg: 'bg-sky-50',    text: 'text-sky-800',    label: 'Parcial' },
    CANCELLED: { bg: 'bg-stone-100', text: 'text-stone-600',  label: 'Cancelado' },
  };
  const c = map[s] ?? map.PENDING;
  return <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${c.bg} ${c.text}`}>{c.label}</span>;
};

export default function WithholdingsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ year: String(new Date().getFullYear()) });
  const [data, setData] = useState<WithholdingGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.profile === 'ADMIN') {
      api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
    }
  }, [user]);

  // Modal de pagar DARF
  const [payModal, setPayModal] = useState<{
    payable_id: string; tributo: TributoKey; amount: string; due_date: string | null;
    period_label: string;
  } | null>(null);

  const reload = () => {
    const params: any = {};
    if (filters.company_id) params.company_id = filters.company_id;
    if (filters.year) params.year = filters.year;
    setLoading(true);
    api.get('/tax/withholdings', { params })
      .then(r => setData(r.data.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const totals = useMemo(() => {
    const sum = (key: keyof Pick<WithholdingGroup, 'total_retained' | 'total_darf' | 'total_paid'>) =>
      data.reduce((s, g) => s + Number(g[key]), 0);
    const alerts = data.filter(g => g.has_alert).length;
    return {
      retained: sum('total_retained'),
      darf: sum('total_darf'),
      paid: sum('total_paid'),
      pending: sum('total_darf') - sum('total_paid'),
      alerts,
    };
  }, [data]);

  const filterDefs = useMemo(() => {
    const defs: any[] = [];
    if (user?.profile === 'ADMIN') {
      defs.push({
        key: 'company_id',
        label: 'Empresa',
        type: 'select',
        options: companies.map(c => ({ value: c.id, label: c.name })),
      });
    }
    defs.push({
      key: 'year',
      label: 'Ano',
      type: 'select',
      options: [2026, 2025, 2024].map(y => ({ value: String(y), label: String(y) })),
    });
    return defs;
  }, [user, companies]);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Retenções na fonte (CSRF)"
        subtitle="Tributos federais retidos sobre serviços tomados de PJ — IRRF + CSLL + PIS + COFINS = 6,15%"
      />

      <FilterBar filters={filterDefs} values={filters} onChange={setFilters} />

      {/* === Cards de totais === */}
      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-stone-200 rounded-sm p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-2">
            <Receipt className="w-3.5 h-3.5" /> Total retido
          </div>
          <div className="font-display text-2xl font-mono">{formatBRL(totals.retained)}</div>
          <div className="text-[11px] text-stone-500 mt-1">somatório das retenções nos pagamentos PJ</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-sm p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> DARFs gerados
          </div>
          <div className="font-display text-2xl font-mono">{formatBRL(totals.darf)}</div>
          <div className="text-[11px] text-stone-500 mt-1">obrigação reconhecida (Receita Federal)</div>
        </div>
        <div className="bg-white border border-stone-200 rounded-sm p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-green-700" /> Pago
          </div>
          <div className="font-display text-2xl font-mono text-green-800">{formatBRL(totals.paid)}</div>
          <div className="text-[11px] text-stone-500 mt-1">DARFs efetivamente recolhidos</div>
        </div>
        <div className={`border rounded-sm p-4 ${totals.alerts > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50/40 border-amber-200'}`}>
          <div className="text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
            <AlertTriangle className={`w-3.5 h-3.5 ${totals.alerts > 0 ? 'text-red-700' : 'text-amber-700'}`} />
            <span className={totals.alerts > 0 ? 'text-red-800' : 'text-amber-800'}>Pendente / Alertas</span>
          </div>
          <div className={`font-display text-2xl font-mono ${totals.pending > 0 ? 'text-amber-800' : 'text-stone-700'}`}>
            {formatBRL(Math.max(0, totals.pending))}
          </div>
          <div className="text-[11px] text-stone-600 mt-1">
            {totals.alerts > 0 ? `${totals.alerts} mês(es) com divergência` : 'todos conciliados'}
          </div>
        </div>
      </div>

      {/* === Tabela mês × tributo === */}
      {loading ? (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center text-stone-500">Carregando…</div>
      ) : data.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Receipt className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhuma retenção encontrada</h3>
          <p className="text-stone-600 text-sm">
            As retenções CSRF aparecem aqui quando há contas a pagar marcadas como <strong>"Serviço tomado de PJ"</strong>.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map(g => (
            <div key={`${g.company_id}-${g.year}-${g.month}`}
                 className={`bg-white border rounded-sm overflow-hidden ${g.has_alert ? 'border-red-300' : 'border-stone-200'}`}>
              <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-display text-lg flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-stone-500" />
                  {monthNames[g.month - 1]}/{g.year}
                  {user?.profile === 'ADMIN' && (
                    <span className="text-sm text-stone-500 font-sans ml-2">· {g.company_name}</span>
                  )}
                  {g.has_alert && (
                    <span className="inline-flex items-center gap-1 ml-2 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-sm border border-red-200">
                      <AlertTriangle className="w-3 h-3" /> divergência
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-stone-600">Retido: <strong className="font-mono ml-1">{formatBRL(g.total_retained)}</strong></span>
                  <span className="text-stone-600">DARF: <strong className="font-mono ml-1">{formatBRL(g.total_darf)}</strong></span>
                  <span className="text-green-700">Pago: <strong className="font-mono ml-1">{formatBRL(g.total_paid)}</strong></span>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Tributo</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Retido (origem)</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">DARF gerado</th>
                    <th className="text-center px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Status DARF</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Recolhido</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Diff</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {g.breakdown.map(b => {
                    const meta = tributoLabels[b.tributo];
                    const canPay = b.darf_payable_id && (b.darf_status === 'PENDING' || b.darf_status === 'PARTIAL');
                    return (
                      <tr key={b.tributo} className="border-b border-stone-100 last:border-0">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                            <span className="text-[10px] text-stone-500">{meta.rate} · cód. {meta.codigo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{formatBRL(b.retained)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatBRL(b.darf_amount)}</td>
                        <td className="px-4 py-2 text-center">{statusBadge(b.darf_status)}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">{formatBRL(b.paid_amount)}</td>
                        <td className={`px-4 py-2 text-right font-mono ${b.alert ? 'text-red-700 font-medium' : 'text-stone-400'}`}>
                          {b.alert === 'MISSING_DARF' && (
                            <span title="Retenção sem DARF correspondente">−{formatBRL(b.diff_retained_darf)}</span>
                          )}
                          {b.alert === 'OVER_DARF' && (
                            <span title="DARF maior que retenção">+{formatBRL(`${-Number(b.diff_retained_darf)}`)}</span>
                          )}
                          {!b.alert && '—'}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {canPay && (
                            <button onClick={() => setPayModal({
                              payable_id: b.darf_payable_id!,
                              tributo: b.tributo,
                              amount: b.darf_amount,
                              due_date: b.darf_due_date,
                              period_label: `${monthNames[g.month - 1]}/${g.year}`,
                            })}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-sm transition">
                              <DollarSign className="w-3.5 h-3.5" /> Pagar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 bg-stone-50 border border-stone-200 rounded-sm p-4 text-xs text-stone-600">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 mt-0.5 text-stone-500 flex-shrink-0" strokeWidth={1.5} />
          <div>
            <strong className="text-stone-800">CSRF — Contribuição Social Retida na Fonte (Lei 9.430/96 + IN RFB 459/04)</strong>
            <p className="mt-1">Quando uma PJ contrata serviços de outra PJ enquadrados na lista taxativa (consultoria, marketing, TI, etc.), o tomador retém na fonte 1,5% IRRF + 1,0% CSLL + 0,65% PIS + 3,0% COFINS = 6,15% e recolhe via DARF mensal consolidado por código de receita. O fornecedor compensa os valores retidos nas suas próprias apurações.</p>
          </div>
        </div>
      </div>

      {/* === Modal de pagar DARF === */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)}
        title={payModal ? `Pagar DARF — ${tributoLabels[payModal.tributo].label} ${payModal.period_label}` : ''} size="md">
        {payModal && (
          <PayDarfForm
            payable_id={payModal.payable_id}
            amount={payModal.amount}
            due_date={payModal.due_date}
            tributo={payModal.tributo}
            companyId={filters.company_id || (user?.profile === 'MANAGER' ? user.company_id : '') || data[0]?.company_id || ''}
            onPaid={() => { setPayModal(null); reload(); }}
            onCancel={() => setPayModal(null)}
          />
        )}
      </Modal>
    </div>
  );
}

// === Form de pagamento de DARF ===
function PayDarfForm({ payable_id, amount, due_date, tributo, companyId, onPaid, onCancel }: {
  payable_id: string; amount: string; due_date: string | null; tributo: TributoKey;
  companyId: string;
  onPaid: () => void; onCancel: () => void;
}) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const [paidAmount, setPaidAmount] = useState(formatBRLInput(Number(amount)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) return;
    api.get('/financial/bank-accounts', { params: { company_id: companyId } })
      .then(r => {
        const list: BankAccount[] = (r.data.data || []).filter((a: BankAccount) => !(a as any).is_player_wallet);
        setAccounts(list);
        if (list.length > 0) setBankAccountId(list[0].id);
      })
      .catch(() => {});
  }, [companyId]);

  const submit = async () => {
    if (!bankAccountId) { setError('Selecione a conta bancária'); return; }
    setSubmitting(true); setError('');
    try {
      await api.post(`/financial/accounts-payable/${payable_id}/pay`, {
        bank_account_id: bankAccountId,
        payment_date: paymentDate,
        paid_amount: parseInputToCents(paidAmount),
      });
      onPaid();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao registrar o pagamento.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm space-y-1">
        <div className="font-medium uppercase text-xs tracking-wider text-stone-600">DARF de retenção CSRF — {tributoLabels[tributo].label}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-stone-500 text-xs">Valor:</span> <span className="font-mono ml-1">{formatBRL(amount)}</span></div>
          <div><span className="text-stone-500 text-xs">Vencimento:</span> <span className="font-mono ml-1">{due_date ? formatDate(due_date) : '—'}</span></div>
        </div>
      </div>
      <Field label="Conta bancária" required>
        <Select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
          <option value="">Selecione…</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (saldo {formatBRL(a.current_balance)})</option>)}
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
      <div className="flex justify-end gap-3 pt-3 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !bankAccountId}>
          {submitting ? 'Pagando…' : 'Confirmar pagamento'}
        </PrimaryButton>
      </div>
    </div>
  );
}
