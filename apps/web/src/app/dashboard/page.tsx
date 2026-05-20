'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  TrendingUp, TrendingDown, Minus, Wallet, Activity, AlertTriangle,
  ShieldCheck, Calendar, ArrowUpRight, ArrowDownRight, Banknote,
  FileText, Users, Receipt, Calculator, ArrowDownCircle, ArrowUpCircle, Key,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate } from '@/lib/format';
import type { Company } from '@/lib/types';

type Period = 'current_month' | 'last_30_days' | 'last_90_days' | 'custom';

interface DarfDue {
  id: string;
  description: string;
  amount: string;
  due_date: string;
}

interface CertExpiring {
  id: string;
  holder_name: string;
  valid_to: string;
}

interface DashboardOverview {
  period: { type: string; label: string; start: string; end: string };
  company: { id: string; name: string; cnpj: string };
  kpis: {
    ggr: { value: string; previous: string; variation_percent: number | null };
    net_profit: { value: string; previous: string; variation_percent: number | null };
    cash_balance: { value: string; accounts_count: number };
    operational_margin: { value: number; previous: number; delta: number };
  };
  alerts: {
    audit_open: number;
    audit_critical: number;
    open_apurations: number;
    darfs_due_7d: DarfDue[];
    certificates_expiring_30d: CertExpiring[];
  };
  ggr_monthly: { year: number; month: number; label: string; ggr: string }[];
  cash_flow_monthly: { year: number; month: number; label: string; inflows: string; outflows: string; net: string }[];
  top_expenses: { name: string; amount: string }[];
  fiscal_summary: { nfse_issued_count: number; csrf_paid: string };
  player_movement: {
    deposits: string; withdrawals: string;
    deposit_count: number; withdrawal_count: number;
    wallet_balance: string; active_players: number;
  };
}

function VariationBadge({ value, inverted = false }: { value: number | null; inverted?: boolean }) {
  if (value === null || value === undefined) return <span className="text-stone-400 text-xs">—</span>;
  const isZero = Math.abs(value) < 0.05;
  if (isZero) return <span className="inline-flex items-center gap-0.5 text-xs text-stone-500"><Minus className="w-3 h-3" /> 0%</span>;
  const isPositive = inverted ? value < 0 : value > 0;
  if (isPositive) {
    return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 font-medium"><TrendingUp className="w-3 h-3" /> {value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-xs text-red-700 font-medium"><TrendingDown className="w-3 h-3" /> {value.toFixed(1)}%</span>;
}

/** Bar chart simples sem dependência externa */
function BarChart({ data, valueKey, color, height = 120 }: {
  data: Array<{ label: string; [k: string]: any }>;
  valueKey: string;
  color: 'emerald' | 'red' | 'gold' | 'mixed';
  height?: number;
}) {
  const values = data.map(d => Number(d[valueKey]));
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => {
        const v = Number(d[valueKey]);
        const h = Math.abs(v) / max * (height - 28);
        const isNeg = v < 0;
        let bar = 'bg-emerald-500';
        if (color === 'red') bar = 'bg-red-500';
        else if (color === 'gold') bar = 'bg-gold';
        else if (color === 'mixed') bar = isNeg ? 'bg-red-500' : 'bg-emerald-500';
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="text-[9px] text-stone-500 font-mono opacity-0 group-hover:opacity-100 transition truncate w-full text-center">
              {v >= 1_000_000 ? `${(v / 100_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 100_000).toFixed(0)}k` : formatBRL(v)}
            </div>
            <div className={`w-full ${bar} rounded-sm transition`} style={{ height: `${h}px`, minHeight: v !== 0 ? '2px' : '0' }} title={`${d.label}: ${formatBRL(v)}`} />
            <div className="text-[9px] text-stone-500 font-mono">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [period, setPeriod] = useState<Period>('current_month');
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })();
  const [customStart, setCustomStart] = useState(monthAgo);
  const [customEnd, setCustomEnd] = useState(today);
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // OWNER (gestor de marca) não tem acesso ao overview gerencial.
  // Redireciona para a tela inicial deles.
  useEffect(() => {
    if (user?.profile === 'OWNER') {
      router.replace('/dashboard/fiscal/claim');
    }
  }, [user, router]);

  useEffect(() => {
    if (user?.profile === 'OWNER') return;
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    });
  }, [user]);

  useEffect(() => {
    if (!companyId) return;
    if (period === 'custom' && (!customStart || !customEnd)) return;
    setLoading(true);
    const params: any = { company_id: companyId, period };
    if (period === 'custom') { params.start_date = customStart; params.end_date = customEnd; }
    api.get('/dashboard/overview', { params })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [companyId, period, customStart, customEnd]);

  const periodLabels: Record<Period, string> = {
    current_month: 'Mês atual',
    last_30_days: 'Últimos 30 dias',
    last_90_days: 'Últimos 90 dias',
    custom: 'Personalizada',
  };

  return (
    <div>
      <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">Dashboard</div>
          <h1 className="font-display text-3xl">Olá, {user?.name?.split(' ')[0]}.</h1>
          <p className="text-stone-600 mt-1 text-sm">Visão consolidada da operação · {data?.period.label ?? '...'}</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.profile === 'ADMIN' && (
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}
              className="px-3 py-2 bg-white border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink">
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="inline-flex bg-white border border-stone-300 rounded-sm overflow-hidden">
            {(['current_month', 'last_30_days', 'last_90_days', 'custom'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-2 text-xs transition ${period === p ? 'bg-ink text-stone-100' : 'text-stone-600 hover:bg-stone-50'}`}>
                {periodLabels[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {period === 'custom' && (
        <div className="bg-white border border-stone-200 rounded-sm p-3 mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">De</label>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Até</label>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink" />
          </div>
          <div className="text-xs text-stone-500 ml-2">
            {customStart && customEnd && new Date(customStart) > new Date(customEnd)
              ? <span className="text-red-700">⚠ Data inicial maior que a final</span>
              : <span>Mostrando dados de {new Date(customStart + 'T00:00:00').toLocaleDateString('pt-BR')} até {new Date(customEnd + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
          </div>
        </div>
      )}

      {loading || !data ? (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center text-stone-500">Carregando…</div>
      ) : (
        <>
          {/* === Linha 1: KPIs principais === */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {/* GGR */}
            <div className="bg-white border border-stone-200 p-5 rounded-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="text-xs uppercase tracking-wider text-stone-500 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-amber-700" /> GGR
                </div>
                <VariationBadge value={data.kpis.ggr.variation_percent} />
              </div>
              <div className="font-display text-2xl font-mono mb-1">{formatBRL(data.kpis.ggr.value)}</div>
              <div className="text-[11px] text-stone-500">vs {formatBRL(data.kpis.ggr.previous)} (anterior)</div>
            </div>

            {/* Lucro líquido */}
            <div className="bg-white border border-stone-200 p-5 rounded-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="text-xs uppercase tracking-wider text-stone-500 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-700" /> Lucro Líquido
                </div>
                <VariationBadge value={data.kpis.net_profit.variation_percent} />
              </div>
              <div className={`font-display text-2xl font-mono mb-1 ${Number(data.kpis.net_profit.value) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {formatBRL(data.kpis.net_profit.value)}
              </div>
              <div className="text-[11px] text-stone-500">GGR − despesas − tributos</div>
            </div>

            {/* Saldo em caixa */}
            <div className="bg-white border border-stone-200 p-5 rounded-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="text-xs uppercase tracking-wider text-stone-500 flex items-center gap-2">
                  <Wallet className="w-3.5 h-3.5 text-sky-700" /> Saldo em Caixa
                </div>
                <span className="text-[10px] text-stone-400">{data.kpis.cash_balance.accounts_count} {data.kpis.cash_balance.accounts_count === 1 ? 'conta' : 'contas'}</span>
              </div>
              <div className="font-display text-2xl font-mono mb-1">{formatBRL(data.kpis.cash_balance.value)}</div>
              <div className="text-[11px] text-stone-500">contas operacionais</div>
            </div>

            {/* Margem */}
            <div className="bg-ink text-stone-100 p-5 rounded-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="text-xs uppercase tracking-wider text-stone-300 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-gold" /> Margem Operacional
                </div>
                <span className={`text-[10px] ${data.kpis.operational_margin.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {data.kpis.operational_margin.delta >= 0 ? '+' : ''}{data.kpis.operational_margin.delta.toFixed(1)}pp
                </span>
              </div>
              <div className="font-display text-2xl font-mono text-gold mb-1">{data.kpis.operational_margin.value.toFixed(1)}%</div>
              <div className="text-[11px] text-stone-300">lucro / GGR</div>
            </div>
          </div>

          {/* === Linha 2: Alertas === */}
          {(data.alerts.audit_open > 0 || data.alerts.open_apurations > 0 || data.alerts.darfs_due_7d.length > 0 || data.alerts.certificates_expiring_30d.length > 0) && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-sm p-4 mb-6">
              <div className="text-xs uppercase tracking-wider text-amber-900 font-medium mb-3 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Atenção · pendências e alertas
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.alerts.audit_open > 0 && (
                  <Link href="/dashboard/audit/history" className="bg-white border border-stone-200 rounded-sm p-3 hover:border-amber-400 transition flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-amber-700 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{data.alerts.audit_open} alerta{data.alerts.audit_open > 1 ? 's' : ''} de auditoria</div>
                      <div className="text-[11px] text-stone-600">{data.alerts.audit_critical > 0 ? `${data.alerts.audit_critical} CRITICAL` : 'sem CRITICAL'}</div>
                    </div>
                  </Link>
                )}
                {data.alerts.open_apurations > 0 && (
                  <Link href="/dashboard/tax/apurations" className="bg-white border border-stone-200 rounded-sm p-3 hover:border-amber-400 transition flex items-center gap-3">
                    <Calculator className="w-5 h-5 text-amber-700 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{data.alerts.open_apurations} apuração{data.alerts.open_apurations > 1 ? 'ões' : ''} aberta{data.alerts.open_apurations > 1 ? 's' : ''}</div>
                      <div className="text-[11px] text-stone-600">aguardando fechamento</div>
                    </div>
                  </Link>
                )}
                {data.alerts.darfs_due_7d.length > 0 && (
                  <Link href="/dashboard/financial/accounts-payable" className="bg-white border border-stone-200 rounded-sm p-3 hover:border-amber-400 transition flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-amber-700 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{data.alerts.darfs_due_7d.length} DARF{data.alerts.darfs_due_7d.length > 1 ? 's' : ''} vencendo</div>
                      <div className="text-[11px] text-stone-600">próximos 7 dias</div>
                    </div>
                  </Link>
                )}
                {data.alerts.certificates_expiring_30d.length > 0 && (
                  <Link href="/dashboard/fiscal/certificates" className="bg-white border border-stone-200 rounded-sm p-3 hover:border-amber-400 transition flex items-center gap-3">
                    <Key className="w-5 h-5 text-amber-700 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{data.alerts.certificates_expiring_30d.length} certificado{data.alerts.certificates_expiring_30d.length > 1 ? 's' : ''} a vencer</div>
                      <div className="text-[11px] text-stone-600">próximos 30 dias</div>
                    </div>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* === Linha 3: Gráficos === */}
          <div className="grid lg:grid-cols-2 gap-3 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg flex items-center gap-2"><Activity className="w-4 h-4 text-amber-700" /> GGR mensal · 12 meses</h3>
                <Link href="/dashboard/ggr" className="text-xs text-stone-500 hover:text-ink">Ver detalhes →</Link>
              </div>
              <BarChart data={data.ggr_monthly} valueKey="ggr" color="gold" height={140} />
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg flex items-center gap-2"><Banknote className="w-4 h-4 text-emerald-700" /> Geração de caixa · 6 meses</h3>
                <Link href="/dashboard/reports/cash-flow" className="text-xs text-stone-500 hover:text-ink">Ver detalhes →</Link>
              </div>
              <BarChart data={data.cash_flow_monthly} valueKey="net" color="mixed" height={140} />
            </div>
          </div>

          {/* === Linha 4: Detalhes operacionais === */}
          <div className="grid lg:grid-cols-3 gap-3">
            {/* Top despesas */}
            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <h3 className="font-display text-base mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-red-700" /> Top despesas · {data.period.label}</h3>
              {data.top_expenses.length === 0 ? (
                <div className="text-xs text-stone-400 italic">Nenhuma despesa no período</div>
              ) : (
                <div className="space-y-2">
                  {data.top_expenses.map((e, i) => {
                    const total = data.top_expenses.reduce((s, x) => s + Number(x.amount), 0);
                    const pct = total > 0 ? (Number(e.amount) / total) * 100 : 0;
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-stone-700 truncate">{e.name}</span>
                          <span className="font-mono text-stone-600 ml-2">{formatBRL(e.amount)}</span>
                        </div>
                        <div className="h-1.5 bg-stone-100 rounded-sm overflow-hidden">
                          <div className="h-full bg-red-400" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Movimentação apostadores */}
            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <h3 className="font-display text-base mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-sky-700" /> Apostadores · {data.period.label}</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowDownCircle className="w-4 h-4 text-emerald-700" />
                    <div>
                      <div>Depósitos</div>
                      <div className="text-[10px] text-stone-500">{data.player_movement.deposit_count} operações</div>
                    </div>
                  </div>
                  <span className="font-mono text-sm text-emerald-700">{formatBRL(data.player_movement.deposits)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowUpCircle className="w-4 h-4 text-red-700" />
                    <div>
                      <div>Saques</div>
                      <div className="text-[10px] text-stone-500">{data.player_movement.withdrawal_count} operações</div>
                    </div>
                  </div>
                  <span className="font-mono text-sm text-red-700">{formatBRL(data.player_movement.withdrawals)}</span>
                </div>
                <div className="border-t border-stone-200 pt-3 flex items-center justify-between">
                  <span className="text-sm">Saldo em carteira</span>
                  <span className="font-mono text-sm font-medium">{formatBRL(data.player_movement.wallet_balance)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Jogadores ativos</span>
                  <span className="font-mono text-sm font-medium">{data.player_movement.active_players.toLocaleString('pt-BR')}</span>
                </div>
              </div>
            </div>

            {/* Resumo fiscal */}
            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <h3 className="font-display text-base mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-purple-700" /> Resumo fiscal · {data.period.label}</h3>
              <div className="space-y-3 text-sm">
                <Link href="/dashboard/fiscal/documents?direction=OUTGOING" className="flex items-center justify-between hover:bg-stone-50 -mx-2 px-2 py-1 rounded-sm transition">
                  <span>NFSe emitidas</span>
                  <span className="font-mono font-medium">{data.fiscal_summary.nfse_issued_count}</span>
                </Link>
                <Link href="/dashboard/tax/withholdings" className="flex items-center justify-between hover:bg-stone-50 -mx-2 px-2 py-1 rounded-sm transition">
                  <span>CSRF recolhido</span>
                  <span className="font-mono font-medium">{formatBRL(data.fiscal_summary.csrf_paid)}</span>
                </Link>
                <Link href="/dashboard/tax/apurations" className="flex items-center justify-between hover:bg-stone-50 -mx-2 px-2 py-1 rounded-sm transition">
                  <span>Apurações abertas</span>
                  <span className={`font-mono font-medium ${data.alerts.open_apurations > 0 ? 'text-amber-700' : ''}`}>{data.alerts.open_apurations}</span>
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
