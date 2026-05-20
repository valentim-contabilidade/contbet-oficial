'use client';

import { useEffect, useState } from 'react';
import { Banknote, ArrowDownCircle, ArrowUpCircle, TrendingUp, TrendingDown, Minus, Calendar, Building2, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import { PageHeader, Field, Select, Input } from '@/components/ui';
import type { Company } from '@/lib/types';

type PeriodType = 'monthly' | 'quarterly' | 'yearly' | 'custom';

interface CashFlowGroup {
  nature_id: string | null;
  nature_name: string;
  dre_section: string | null;
  realized: string;
  projected: string;
  total: string;
  percent_of_inflows?: number | null;
  percent_of_outflows?: number | null;
}

interface CashFlowResponse {
  period: { type: string; label: string; start: string; end: string };
  company: { id: string; name: string; cnpj: string };
  include_projected: boolean;
  summary: {
    initial_balance: string;
    final_balance: string;
    cash_generation: string;
    total_inflows: string;
    total_outflows: string;
  };
  inflows:  { realized: string; projected: string; groups: CashFlowGroup[] };
  outflows: { realized: string; projected: string; groups: CashFlowGroup[] };
  bank_accounts: { name: string; current_balance: string }[];
}

function pct(v: number, total: number): string {
  if (!total) return '—';
  return `${((v / total) * 100).toFixed(1)}%`;
}

function GroupRow({ g, totalForPercent, color }: { g: CashFlowGroup; totalForPercent: number; color: 'green' | 'red' }) {
  const total = Number(g.total);
  const realized = Number(g.realized);
  const projected = Number(g.projected);
  const hasProjected = projected > 0;
  const colorClasses = color === 'green' ? 'text-emerald-700' : 'text-red-700';
  return (
    <tr className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
      <td className="px-4 py-2 text-sm">
        <div>{g.nature_name}</div>
        {g.dre_section && (
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mt-0.5">{g.dre_section.replace(/_/g, ' ').toLowerCase()}</div>
        )}
      </td>
      <td className={`px-4 py-2 text-right font-mono text-sm ${colorClasses}`}>{formatBRL(realized)}</td>
      <td className={`px-4 py-2 text-right font-mono text-sm ${hasProjected ? 'text-amber-700' : 'text-stone-300'}`}>
        {hasProjected ? formatBRL(projected) : '—'}
      </td>
      <td className={`px-4 py-2 text-right font-mono text-sm font-medium ${colorClasses}`}>{formatBRL(total)}</td>
      <td className="px-4 py-2 text-right text-xs text-stone-500 font-mono">{pct(total, totalForPercent)}</td>
    </tr>
  );
}

export default function CashFlowPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const today = new Date();
  const [companyId, setCompanyId] = useState('');
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [includeProjected, setIncludeProjected] = useState(true);
  const [data, setData] = useState<CashFlowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true); setError('');
    const params: any = { company_id: companyId, period_type: periodType, year, include_projected: includeProjected };
    if (periodType === 'monthly') params.month = month;
    api.get('/reports/cash-flow', { params })
      .then(r => setData(r.data))
      .catch(err => setError(err?.response?.data?.message ?? 'Erro ao gerar relatório'))
      .finally(() => setLoading(false));
  }, [companyId, periodType, year, month, includeProjected]);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const summary = data?.summary;
  const cashGen = summary ? Number(summary.cash_generation) : 0;
  const totalInflows  = summary ? Number(summary.total_inflows)  : 0;
  const totalOutflows = summary ? Number(summary.total_outflows) : 0;

  return (
    <div>
      <PageHeader
        title="Fluxo de Caixa"
        subtitle="Forma direta · entradas e saídas realizadas + projetadas no período"
      />

      {/* Filtros */}
      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-5 gap-3 items-end">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Período">
          <Select value={periodType} onChange={e => setPeriodType(e.target.value as PeriodType)}>
            <option value="monthly">Mensal</option>
            <option value="quarterly">Trimestral</option>
            <option value="yearly">Anual</option>
          </Select>
        </Field>
        <Field label="Ano">
          <Select value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
        {periodType === 'monthly' && (
          <Field label="Mês">
            <Select value={month} onChange={e => setMonth(parseInt(e.target.value))}>
              {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Projeções">
          <label className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-300 rounded-sm cursor-pointer">
            <input type="checkbox" checked={includeProjected} onChange={e => setIncludeProjected(e.target.checked)} />
            <span className="text-sm">Incluir a vencer</span>
          </label>
        </Field>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-sm mb-6 text-sm">{error}</div>}

      {loading && <div className="bg-white border border-stone-200 rounded-sm p-12 text-center text-stone-500">Calculando…</div>}

      {data && summary && !loading && (
        <>
          {/* === Cards do summary === */}
          <div className="grid sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5" /> Saldo inicial
              </div>
              <div className="font-display text-2xl font-mono">{formatBRL(summary.initial_balance)}</div>
              <div className="text-[10px] text-stone-500 mt-1">início do período</div>
            </div>
            <div className="bg-white border border-emerald-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-emerald-700 mb-2 flex items-center gap-2">
                <ArrowDownCircle className="w-3.5 h-3.5" /> Entradas
              </div>
              <div className="font-display text-2xl font-mono text-emerald-700">{formatBRL(summary.total_inflows)}</div>
              <div className="text-[10px] text-stone-500 mt-1">
                R {formatBRL(data.inflows.realized)}{data.include_projected && Number(data.inflows.projected) > 0 && ` · P ${formatBRL(data.inflows.projected)}`}
              </div>
            </div>
            <div className="bg-white border border-red-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-red-700 mb-2 flex items-center gap-2">
                <ArrowUpCircle className="w-3.5 h-3.5" /> Saídas
              </div>
              <div className="font-display text-2xl font-mono text-red-700">{formatBRL(summary.total_outflows)}</div>
              <div className="text-[10px] text-stone-500 mt-1">
                R {formatBRL(data.outflows.realized)}{data.include_projected && Number(data.outflows.projected) > 0 && ` · P ${formatBRL(data.outflows.projected)}`}
              </div>
            </div>
            <div className={`border rounded-sm p-4 ${cashGen >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
              <div className={`text-xs uppercase tracking-wider mb-2 flex items-center gap-2 ${cashGen >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                {cashGen >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {cashGen >= 0 ? 'Geração de caixa' : 'Queima de caixa'}
              </div>
              <div className={`font-display text-2xl font-mono ${cashGen >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                {formatBRL(cashGen)}
              </div>
              <div className="text-[10px] text-stone-600 mt-1">saldo final {formatBRL(summary.final_balance)}</div>
            </div>
          </div>

          {/* === Grid de entradas e saídas === */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Entradas */}
            <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
              <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-200">
                <h3 className="font-display text-lg flex items-center gap-2 text-emerald-900">
                  <ArrowDownCircle className="w-4 h-4" /> Entradas
                  <span className="ml-auto text-sm font-mono">{formatBRL(summary.total_inflows)}</span>
                </h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">Origem</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">Realizado</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">A receber</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">Total</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inflows.groups.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-stone-400 italic text-xs">Nenhuma entrada no período</td></tr>
                  ) : data.inflows.groups.map(g => <GroupRow key={g.nature_name} g={g} totalForPercent={totalInflows} color="green" />)}
                </tbody>
              </table>
            </div>

            {/* Saídas */}
            <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <h3 className="font-display text-lg flex items-center gap-2 text-red-900">
                  <ArrowUpCircle className="w-4 h-4" /> Saídas
                  <span className="ml-auto text-sm font-mono">{formatBRL(summary.total_outflows)}</span>
                </h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">Destino</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">Realizado</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">A pagar</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">Total</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-wider text-stone-600">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outflows.groups.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-stone-400 italic text-xs">Nenhuma saída no período</td></tr>
                  ) : data.outflows.groups.map(g => <GroupRow key={g.nature_name} g={g} totalForPercent={totalOutflows} color="red" />)}
                </tbody>
              </table>
            </div>
          </div>

          {/* === Resumo final === */}
          <div className="bg-ink text-stone-100 rounded-sm p-5 mb-6">
            <h3 className="font-display text-lg mb-4 flex items-center gap-2"><Banknote className="w-4 h-4 text-gold" /> Resumo do período</h3>
            <div className="grid sm:grid-cols-5 gap-3 text-sm font-mono">
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">Saldo inicial</div>
                <div className="text-base">{formatBRL(summary.initial_balance)}</div>
              </div>
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">(+) Entradas</div>
                <div className="text-base text-emerald-300">+{formatBRL(summary.total_inflows)}</div>
              </div>
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">(−) Saídas</div>
                <div className="text-base text-red-300">−{formatBRL(summary.total_outflows)}</div>
              </div>
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">(=) Geração</div>
                <div className={`text-base ${cashGen >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{formatBRL(cashGen)}</div>
              </div>
              <div>
                <div className="text-[10px] text-gold uppercase tracking-wider mb-1">Saldo final</div>
                <div className="text-base text-gold font-bold">{formatBRL(summary.final_balance)}</div>
              </div>
            </div>
          </div>

          {/* === Contas bancárias === */}
          {data.bank_accounts.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <h3 className="font-display text-base mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-stone-500" /> Contas bancárias (saldo atual)</h3>
              <div className="grid sm:grid-cols-3 gap-3">
                {data.bank_accounts.map((b, i) => (
                  <div key={i} className="bg-stone-50 border border-stone-200 rounded-sm p-3">
                    <div className="text-xs text-stone-600 truncate">{b.name}</div>
                    <div className="font-mono text-base font-medium mt-1">{formatBRL(b.current_balance)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notas explicativas */}
          <div className="mt-4 text-xs text-stone-500 italic">
            <p>Realizado: somatório dos lançamentos bancários (Caixa e Bancos) no período.
              {data.include_projected && ' Projetado: contas a pagar/receber pendentes com vencimento no período.'}</p>
            <p>Forma direta — entradas e saídas reais agrupadas por natureza contábil. Para conciliação contábil (CPC 03 — DFC indireta), consulte a DRE Contábil.</p>
          </div>
        </>
      )}
    </div>
  );
}
