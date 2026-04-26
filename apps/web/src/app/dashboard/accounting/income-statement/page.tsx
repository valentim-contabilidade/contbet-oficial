'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

interface Row {
  account_id: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  depth: number;
  balance: string;
  aggregated: string;
  is_synthetic: boolean;
}

interface IncomeStatement {
  rows: Row[];
  total_revenue: string;
  total_expense: string;
  net_income: string;
  from: string;
  to: string;
}

export default function IncomeStatementPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(todayInput());
  const [data, setData] = useState<IncomeStatement | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    api.get('/accounting/income-statement', { params: { company_id: companyId, from, to } })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [companyId, from, to]);

  const revenueRows = data?.rows.filter(r => r.type === 'REVENUE') ?? [];
  const expenseRows = data?.rows.filter(r => r.type === 'EXPENSE') ?? [];
  const totalRevenue = data?.total_revenue ?? '0';
  const totalExpense = data?.total_expense ?? '0';
  const netIncome = data?.net_income ?? '0';
  const margin = BigInt(totalRevenue) !== 0n
    ? Number((BigInt(netIncome) * 10000n) / BigInt(totalRevenue)) / 100
    : 0;

  return (
    <div>
      <PageHeader title="DRE Contábil" subtitle="Demonstração do Resultado a partir dos lançamentos contábeis (regime de competência)" />

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-3 gap-3">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="De">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </Field>
      </div>

      {loading && <div className="text-center text-stone-500 py-12">Carregando…</div>}

      {!loading && data && (
        <>
          {/* Cards de topo */}
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-sm">
              <div className="text-xs uppercase tracking-wider text-emerald-800 mb-1">Receita Total</div>
              <div className="font-display text-2xl text-emerald-900 font-mono">{formatBRL(totalRevenue)}</div>
            </div>
            <div className="bg-red-50 border border-red-200 p-4 rounded-sm">
              <div className="text-xs uppercase tracking-wider text-red-800 mb-1">Despesa Total</div>
              <div className="font-display text-2xl text-red-900 font-mono">{formatBRL(totalExpense)}</div>
            </div>
            <div className="bg-ink text-stone-100 p-4 rounded-sm">
              <div className="text-xs uppercase tracking-wider text-stone-300 mb-1">Resultado Líquido</div>
              <div className={`font-display text-2xl font-mono ${BigInt(netIncome) >= 0n ? 'text-gold' : 'text-rose-300'}`}>
                {formatBRL(netIncome)}
              </div>
              <div className="text-[10px] text-stone-400 mt-1">Margem: {margin.toFixed(2)}%</div>
            </div>
          </div>

          {/* DRE estruturada */}
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Saldo</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600 w-20">% RL</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-emerald-50 border-b border-emerald-200">
                  <td className="px-4 py-2 font-medium text-emerald-900 uppercase tracking-wider text-xs">(+) Receitas</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-900">{formatBRL(totalRevenue)}</td>
                  <td className="px-4 py-2 text-right text-xs text-emerald-900">100,00%</td>
                </tr>
                {revenueRows.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-4 text-center text-stone-400 text-xs">Sem receitas no período.</td></tr>
                )}
                {revenueRows.map(r => {
                  const pct = BigInt(totalRevenue) !== 0n
                    ? Number((BigInt(r.aggregated) * 10000n) / BigInt(totalRevenue)) / 100
                    : 0;
                  return (
                    <tr key={r.account_id} className="border-b border-stone-100">
                      <td className={`px-4 py-1.5 ${r.is_synthetic ? 'font-medium' : ''}`} style={{ paddingLeft: 16 + r.depth * 18 }}>
                        <span className="font-mono text-xs text-stone-500 mr-2">{r.code}</span>
                        {r.name}
                      </td>
                      <td className={`px-4 py-1.5 text-right font-mono ${r.is_synthetic ? 'font-semibold' : ''}`}>{formatBRL(r.aggregated)}</td>
                      <td className="px-4 py-1.5 text-right text-[11px] text-stone-500">{pct.toFixed(2)}%</td>
                    </tr>
                  );
                })}

                <tr className="bg-red-50 border-b border-red-200 border-t-2 border-t-stone-300">
                  <td className="px-4 py-2 font-medium text-red-900 uppercase tracking-wider text-xs">(−) Despesas</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-red-900">{formatBRL(totalExpense)}</td>
                  <td className="px-4 py-2 text-right text-xs text-red-900">
                    {BigInt(totalRevenue) !== 0n ? `${(Number((BigInt(totalExpense) * 10000n) / BigInt(totalRevenue)) / 100).toFixed(2)}%` : '—'}
                  </td>
                </tr>
                {expenseRows.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-4 text-center text-stone-400 text-xs">Sem despesas no período.</td></tr>
                )}
                {expenseRows.map(r => {
                  const pct = BigInt(totalRevenue) !== 0n
                    ? Number((BigInt(r.aggregated) * 10000n) / BigInt(totalRevenue)) / 100
                    : 0;
                  return (
                    <tr key={r.account_id} className="border-b border-stone-100">
                      <td className={`px-4 py-1.5 ${r.is_synthetic ? 'font-medium' : ''}`} style={{ paddingLeft: 16 + r.depth * 18 }}>
                        <span className="font-mono text-xs text-stone-500 mr-2">{r.code}</span>
                        {r.name}
                      </td>
                      <td className={`px-4 py-1.5 text-right font-mono ${r.is_synthetic ? 'font-semibold' : ''}`}>{formatBRL(r.aggregated)}</td>
                      <td className="px-4 py-1.5 text-right text-[11px] text-stone-500">{pct.toFixed(2)}%</td>
                    </tr>
                  );
                })}

                <tr className="bg-ink text-stone-100 border-t-2 border-t-stone-300">
                  <td className="px-4 py-3 font-display text-sm uppercase tracking-wider">(=) Resultado Líquido do Período</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${BigInt(netIncome) >= 0n ? 'text-gold' : 'text-rose-300'}`}>
                    {formatBRL(netIncome)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">{margin.toFixed(2)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
