'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, AlertTriangle, ShieldCheck, ShieldX, Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate } from '@/lib/format';
import { PageHeader, Field, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

type AlertLevel = 'OK' | 'WARNING' | 'CRITICAL';
type CheckType = 'MOVEMENTS' | 'FEES' | 'TAXES';

interface Check {
  id: string;
  type: CheckType;
  created_at: string;
  from_date: string;
  to_date: string;
  alert_level: AlertLevel;
  // Movements
  diff_net?: string; sistema_net?: string; banco_net?: string;
  // Fees
  expected_total_fees?: string; actual_total_fees?: string; diff_total_fees?: string;
  // Taxes
  calculated_total?: string; paid_total?: string; diff_total?: string;
}

interface AuditAlert {
  id: string;
  check_type: CheckType;
  reference_id: string;
  previous_level: AlertLevel | null;
  current_level: AlertLevel;
  message: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
}

interface History {
  movements: Check[];
  fees: Check[];
  taxes: Check[];
}

const typeLabels: Record<CheckType, string> = {
  MOVEMENTS: 'Movimentação',
  FEES: 'Tarifas',
  TAXES: 'Tributos',
};
const typeRoutes: Record<CheckType, string> = {
  MOVEMENTS: '/dashboard/audit/movements',
  FEES: '/dashboard/audit/fees',
  TAXES: '/dashboard/audit/taxes',
};

const alertColors: Record<AlertLevel, { bg: string; text: string; border: string }> = {
  OK: { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300' },
  WARNING: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
  CRITICAL: { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300' },
};
const alertIcons: Record<AlertLevel, any> = {
  OK: ShieldCheck, WARNING: AlertTriangle, CRITICAL: ShieldX,
};
const levelRank: Record<AlertLevel, number> = { OK: 0, WARNING: 1, CRITICAL: 2 };

function diffOf(check: Check): string {
  if (check.type === 'MOVEMENTS') return check.diff_net ?? '0';
  if (check.type === 'FEES') return check.diff_total_fees ?? '0';
  return check.diff_total ?? '0';
}

export default function AuditHistoryPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [history, setHistory] = useState<History | null>(null);
  const [alerts, setAlerts] = useState<AuditAlert[]>([]);
  const [filter, setFilter] = useState<'ALL' | CheckType>('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    }).catch(() => {});
  }, [user]);

  const reload = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [h, a] = await Promise.all([
        api.get(`/audit/history/${companyId}`),
        api.get(`/audit/alerts/${companyId}`),
      ]);
      setHistory(h.data);
      setAlerts(a.data.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId]);

  const ackAlert = async (id: string) => {
    await api.post(`/audit/alerts/${id}/ack`);
    await reload();
  };

  const allChecks = useMemo(() => {
    if (!history) return [];
    const all = [...history.movements, ...history.fees, ...history.taxes];
    return all
      .filter(c => filter === 'ALL' || c.type === filter)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [history, filter]);

  // Sparkline data: para cada tipo, últimas 30 entradas em ordem cronológica
  const sparkData: Record<CheckType, Check[]> = useMemo(() => {
    const out: Record<CheckType, Check[]> = { MOVEMENTS: [], FEES: [], TAXES: [] };
    if (!history) return out;
    out.MOVEMENTS = [...history.movements].reverse().slice(-30);
    out.FEES = [...history.fees].reverse().slice(-30);
    out.TAXES = [...history.taxes].reverse().slice(-30);
    return out;
  }, [history]);

  const openAlerts = alerts.filter(a => !a.acknowledged);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Histórico de auditorias"
        subtitle="Todas as verificações executadas + alertas pendentes"
      />

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-2 gap-3">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Tipo de verificação">
          <Select value={filter} onChange={e => setFilter(e.target.value as any)}>
            <option value="ALL">Todos</option>
            <option value="MOVEMENTS">Movimentação</option>
            <option value="FEES">Tarifas</option>
            <option value="TAXES">Tributos</option>
          </Select>
        </Field>
      </div>

      {/* Alertas pendentes */}
      {openAlerts.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden mb-6">
          <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center gap-3">
            <Bell className="w-4 h-4 text-red-700" />
            <h2 className="font-display text-lg text-red-800">Alertas pendentes ({openAlerts.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Quando</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Transição</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Mensagem</th>
                <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Ação</th>
              </tr>
            </thead>
            <tbody>
              {openAlerts.map(a => {
                const PrevIcon = a.previous_level ? alertIcons[a.previous_level] : null;
                const CurrIcon = alertIcons[a.current_level];
                return (
                  <tr key={a.id} className="border-b border-stone-100">
                    <td className="px-4 py-2 text-xs text-stone-600">{new Date(a.created_at).toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-2 text-xs">{typeLabels[a.check_type]}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className="inline-flex items-center gap-1">
                        {a.previous_level ? (
                          <>
                            {PrevIcon && <PrevIcon className="w-3 h-3" />}
                            <span className={alertColors[a.previous_level].text}>{a.previous_level}</span>
                          </>
                        ) : <span className="text-stone-500">—</span>}
                        <span className="text-stone-400">→</span>
                        <CurrIcon className="w-3 h-3" />
                        <span className={`font-medium ${alertColors[a.current_level].text}`}>{a.current_level}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-stone-700">{a.message}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => ackAlert(a.id)} className="text-xs px-2 py-1 bg-ink text-stone-100 rounded-sm hover:bg-ink/90">
                        Reconhecer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sparklines de tendência */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {(['MOVEMENTS', 'FEES', 'TAXES'] as CheckType[]).map(t => {
          const data = sparkData[t];
          const recent = data.slice(-12);
          const maxRank = recent.reduce((m, c) => Math.max(m, levelRank[c.alert_level]), 0);
          const lastLevel = data[data.length - 1]?.alert_level ?? 'OK';
          return (
            <div key={t} className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">{typeLabels[t]}</div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-3 h-3 rounded-full ${lastLevel === 'OK' ? 'bg-green-500' : lastLevel === 'WARNING' ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span className="text-sm">Último: <strong>{lastLevel}</strong></span>
              </div>
              {data.length === 0 ? (
                <div className="text-xs text-stone-500">Nenhuma verificação executada ainda.</div>
              ) : (
                <>
                  <div className="flex items-end gap-0.5 h-12">
                    {recent.map((c, i) => {
                      const r = levelRank[c.alert_level];
                      const h = Math.max(8, (r + 1) * 16); // 8/24/40 px
                      const bg = c.alert_level === 'OK' ? 'bg-green-500' : c.alert_level === 'WARNING' ? 'bg-amber-500' : 'bg-red-500';
                      return <div key={c.id} className={`flex-1 rounded-t-sm ${bg}`} style={{ height: `${h}px` }} title={`${formatDate(c.from_date)} → ${formatDate(c.to_date)}: ${c.alert_level}`} />;
                    })}
                  </div>
                  <div className="text-[11px] text-stone-500 mt-2">{recent.length} última(s) verificação(ões)</div>
                </>
              )}
              <Link href={typeRoutes[t]} className="text-xs text-ink underline mt-3 inline-block">Nova verificação →</Link>
            </div>
          );
        })}
      </div>

      {/* Histórico completo */}
      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-3">
          <History className="w-4 h-4 text-stone-500" />
          <h2 className="font-display text-lg">Histórico completo</h2>
        </div>
        {loading && <div className="text-center text-stone-500 py-8">Carregando…</div>}
        {!loading && allChecks.length === 0 && (
          <div className="text-center text-stone-500 py-12">Nenhuma verificação executada ainda.</div>
        )}
        {!loading && allChecks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Quando</th>
                  <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                  <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Período</th>
                  <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Diferença</th>
                  <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Status</th>
                  <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {allChecks.map(c => {
                  const Icon = alertIcons[c.alert_level];
                  return (
                    <tr key={`${c.type}-${c.id}`} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-2 text-xs text-stone-600 whitespace-nowrap">{new Date(c.created_at).toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-2">{typeLabels[c.type]}</td>
                      <td className="px-4 py-2 text-xs">{formatDate(c.from_date)} → {formatDate(c.to_date)}</td>
                      <td className={`px-4 py-2 text-right font-mono ${BigInt(diffOf(c)) === 0n ? '' : BigInt(diffOf(c)) < 0n ? 'text-red-700' : 'text-emerald-700'}`}>
                        {formatBRL(diffOf(c))}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm ${alertColors[c.alert_level].bg} ${alertColors[c.alert_level].text} ${alertColors[c.alert_level].border} border`}>
                          <Icon className="w-3 h-3" /> {c.alert_level}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link href={typeRoutes[c.type]} className="text-xs text-ink underline">Reexecutar</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
