'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wallet, ArrowUpCircle, ArrowDownCircle, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import type { FinancialDashboard, CashFlow } from '@/lib/types';

export default function FinancialDashboardPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<FinancialDashboard | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/financial/reports/dashboard').then(r => r.data),
      api.get('/financial/reports/cash-flow').then(r => r.data),
    ]).then(([d, cf]) => {
      setDashboard(d);
      setCashFlow(cf);
    }).catch(err => {
      console.error(err);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center text-stone-500 py-20">Carregando dashboard financeiro...</div>;
  }

  if (!dashboard) {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">
      Não foi possível carregar os dados financeiros.
    </div>;
  }

  const monthLabel = monthNames[(dashboard.month.month - 1)];

  // Calcula o máximo absoluto para escalar o gráfico
  const maxValue = cashFlow ? Math.max(
    ...cashFlow.months.map(m => Math.max(Number(m.income), Number(m.expense)))
  ) : 1;

  return (
    <div>
      <div className="mb-8">
        <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">Financeiro · Visão geral</div>
        <h1 className="font-display text-4xl">Painel Financeiro</h1>
        <p className="text-stone-600 mt-2">Resumo das contas, vencimentos e movimentação financeira.</p>
      </div>

      {/* Cards principais */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-stone-200 p-6 rounded-sm">
          <Wallet className="w-5 h-5 text-gold mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Saldo total</div>
          <div className="font-display text-3xl text-ink">{formatBRL(dashboard.balance.total)}</div>
          <div className="text-xs text-stone-500 mt-2">{dashboard.balance.accounts_count} {dashboard.balance.accounts_count === 1 ? 'conta' : 'contas'}</div>
        </div>

        <div className="bg-white border border-stone-200 p-6 rounded-sm">
          <ArrowUpCircle className="w-5 h-5 text-red-600 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">A pagar</div>
          <div className="font-display text-3xl text-ink">{formatBRL(dashboard.payable.pending_total)}</div>
          <Link href="/dashboard/financial/accounts-payable" className="text-xs text-stone-500 mt-2 block hover:text-gold">
            {dashboard.payable.count} {dashboard.payable.count === 1 ? 'pendente' : 'pendentes'} →
          </Link>
        </div>

        <div className="bg-white border border-stone-200 p-6 rounded-sm">
          <ArrowDownCircle className="w-5 h-5 text-green-700 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">A receber</div>
          <div className="font-display text-3xl text-ink">{formatBRL(dashboard.receivable.pending_total)}</div>
          <Link href="/dashboard/financial/accounts-receivable" className="text-xs text-stone-500 mt-2 block hover:text-gold">
            {dashboard.receivable.count} {dashboard.receivable.count === 1 ? 'pendente' : 'pendentes'} →
          </Link>
        </div>

        <div className="bg-white border border-stone-200 p-6 rounded-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Vencidos</div>
          <div className="font-display text-3xl text-ink">{formatBRL(Number(dashboard.payable.overdue_total) + Number(dashboard.receivable.overdue_total))}</div>
          <div className="text-xs text-stone-500 mt-2">
            {dashboard.payable.overdue_count + dashboard.receivable.overdue_count} {dashboard.payable.overdue_count + dashboard.receivable.overdue_count === 1 ? 'título' : 'títulos'}
          </div>
        </div>
      </div>

      {/* Movimento do mês */}
      <div className="bg-white border border-stone-200 rounded-sm p-8 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Movimento</div>
            <h2 className="font-display text-2xl">{monthLabel} de {dashboard.month.year}</h2>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 mb-2">
              <TrendingUp className="w-4 h-4 text-green-700" /> Entradas
            </div>
            <div className="font-display text-2xl text-green-700">{formatBRL(dashboard.month.income)}</div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 mb-2">
              <TrendingDown className="w-4 h-4 text-red-600" /> Saídas
            </div>
            <div className="font-display text-2xl text-red-600">{formatBRL(dashboard.month.expense)}</div>
          </div>
          <div className="border-l border-stone-200 pl-6">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Resultado</div>
            <div className={`font-display text-2xl ${Number(dashboard.month.net) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {formatBRL(dashboard.month.net)}
            </div>
          </div>
        </div>
      </div>

      {/* Fluxo de caixa anual */}
      {cashFlow && (
        <div className="bg-white border border-stone-200 rounded-sm p-8">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Fluxo de Caixa</div>
            <h2 className="font-display text-2xl">{cashFlow.year}</h2>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Gráfico de barras simples em SVG */}
              <div className="flex items-end gap-2 h-48 mb-4">
                {cashFlow.months.map((m, i) => {
                  const inc = Number(m.income);
                  const exp = Number(m.expense);
                  const incHeight = maxValue > 0 ? (inc / maxValue) * 100 : 0;
                  const expHeight = maxValue > 0 ? (exp / maxValue) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center group relative">
                      <div className="w-full flex gap-0.5 items-end h-44">
                        <div className="flex-1 bg-green-600/80 hover:bg-green-700 transition rounded-t-sm" style={{ height: `${incHeight}%` }} title={`Entradas: ${formatBRL(inc)}`}></div>
                        <div className="flex-1 bg-red-500/80 hover:bg-red-600 transition rounded-t-sm" style={{ height: `${expHeight}%` }} title={`Saídas: ${formatBRL(exp)}`}></div>
                      </div>
                      <div className="text-xs text-stone-500 mt-2">{monthNames[i]}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-6 text-xs text-stone-600 justify-center pt-4 border-t border-stone-200">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-green-600/80 rounded-sm"></div>Entradas</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500/80 rounded-sm"></div>Saídas</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
