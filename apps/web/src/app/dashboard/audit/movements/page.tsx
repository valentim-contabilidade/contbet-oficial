'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, AlertTriangle, ShieldX, Play, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select, PrimaryButton } from '@/components/ui';
import type { Company } from '@/lib/types';

type AlertLevel = 'OK' | 'WARNING' | 'CRITICAL';

interface DailyRow {
  date: string;
  sistema_deposits: string; sistema_withdrawals: string; sistema_net: string;
  banco_deposits: string;   banco_withdrawals: string;   banco_net: string;
  diff_deposits: string;    diff_withdrawals: string;    diff_net: string;
  cumulative_diff_net: string;
}

interface CheckResult {
  check_id: string;
  created_at: string;
  from: string; to: string;
  totals: {
    sistema: { deposits: string; withdrawals: string; net: string };
    banco:   { deposits: string; withdrawals: string; net: string };
    diff:    { deposits: string; withdrawals: string; net: string };
  };
  alert_level: AlertLevel;
  player_accounts: { id: string; name: string }[];
  daily_breakdown: DailyRow[];
  has_data: boolean;
  missing_player_account: boolean;
}

const alertConfig: Record<AlertLevel, { label: string; bg: string; text: string; border: string; Icon: any }> = {
  OK: { label: 'Conferido · sem divergência relevante', bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300', Icon: ShieldCheck },
  WARNING: { label: 'Atenção · divergência acima da tolerância 1%', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', Icon: AlertTriangle },
  CRITICAL: { label: 'Crítico · divergência acima da tolerância 5%', bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', Icon: ShieldX },
};

export default function MovementsAuditPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`);
  const [to, setTo] = useState(todayInput());
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    }).catch(() => {});
  }, [user]);

  const runCheck = async () => {
    if (!companyId || !from || !to) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await api.post('/audit/movements-check', { company_id: companyId, from, to });
      setResult(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao executar verificação.');
    } finally { setLoading(false); }
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const alert = result ? alertConfig[result.alert_level] : null;
  const AlertIcon = alert?.Icon ?? ShieldCheck;

  return (
    <div>
      <PageHeader
        title="Auditoria · Movimentação"
        subtitle="Cruzamento entre depósitos e saques registrados pelo sistema de apostas e pelos extratos das contas operacionais"
      />

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-4 gap-3 items-end">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="De">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </Field>
        <PrimaryButton onClick={runCheck} disabled={loading || !companyId}>
          <Play className="w-4 h-4 inline mr-2" /> {loading ? 'Verificando…' : 'Executar verificação'}
        </PrimaryButton>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-sm mb-6 text-sm">{error}</div>}

      {result?.missing_player_account && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <strong>Nenhuma conta marcada como "carteira de apostadores".</strong> Vá em
            {' '}<Link href="/dashboard/financial/bank-accounts" className="underline font-medium">Contas Bancárias</Link>,
            edite as contas que custodiam dinheiro dos apostadores e marque a opção
            <em> "Conta de carteira de apostadores"</em>. Sem isso a verificação não captura o lado bancário.
          </div>
        </div>
      )}

      {result && alert && (
        <>
          {/* Banner de status */}
          <div className={`${alert.bg} ${alert.text} border ${alert.border} rounded-sm p-5 mb-6 flex items-start gap-4`}>
            <AlertIcon className="w-7 h-7 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider mb-1">Resultado da verificação</div>
              <div className="font-display text-xl">{alert.label}</div>
              <div className="text-xs mt-1 opacity-80">
                Período {formatDate(result.from)} até {formatDate(result.to)} · executada em {new Date(result.created_at).toLocaleString('pt-BR')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider opacity-80">Diferença líquida</div>
              <div className="font-display text-2xl font-mono">{formatBRL(result.totals.diff.net)}</div>
            </div>
          </div>

          {/* Cards de totais */}
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Sistema de apostas</div>
              <div className="text-xs text-stone-600">Depósitos</div>
              <div className="font-mono font-medium">{formatBRL(result.totals.sistema.deposits)}</div>
              <div className="text-xs text-stone-600 mt-2">Saques</div>
              <div className="font-mono font-medium">{formatBRL(result.totals.sistema.withdrawals)}</div>
              <div className="border-t border-stone-200 mt-3 pt-2">
                <div className="text-xs text-stone-600">Líquido</div>
                <div className="font-display text-xl font-mono">{formatBRL(result.totals.sistema.net)}</div>
              </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Extratos bancários</div>
              <div className="text-xs text-stone-600">Créditos (depósitos)</div>
              <div className="font-mono font-medium">{formatBRL(result.totals.banco.deposits)}</div>
              <div className="text-xs text-stone-600 mt-2">Débitos (saques)</div>
              <div className="font-mono font-medium">{formatBRL(result.totals.banco.withdrawals)}</div>
              <div className="border-t border-stone-200 mt-3 pt-2">
                <div className="text-xs text-stone-600">Líquido</div>
                <div className="font-display text-xl font-mono">{formatBRL(result.totals.banco.net)}</div>
              </div>
            </div>

            <div className="bg-ink text-stone-100 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-300 mb-2">Diferença (banco − sistema)</div>
              <div className="text-xs text-stone-300">Depósitos</div>
              <div className="font-mono font-medium">{formatBRL(result.totals.diff.deposits)}</div>
              <div className="text-xs text-stone-300 mt-2">Saques</div>
              <div className="font-mono font-medium">{formatBRL(result.totals.diff.withdrawals)}</div>
              <div className="border-t border-white/15 mt-3 pt-2">
                <div className="text-xs text-stone-300">Líquido</div>
                <div className={`font-display text-xl font-mono ${BigInt(result.totals.diff.net) === 0n ? 'text-gold' : (BigInt(result.totals.diff.net) < 0n ? 'text-rose-300' : 'text-emerald-300')}`}>
                  {formatBRL(result.totals.diff.net)}
                </div>
              </div>
            </div>
          </div>

          {/* Contas marcadas como player_wallet */}
          {result.player_accounts.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Contas auditadas (carteira de apostadores)</div>
              <div className="flex flex-wrap gap-2">
                {result.player_accounts.map(a => (
                  <span key={a.id} className="text-xs bg-stone-100 text-stone-800 border border-stone-200 px-2 py-1 rounded-sm">{a.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Tabela diária */}
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th rowSpan={2} className="text-left px-3 py-2 uppercase tracking-wider text-stone-600 align-bottom">Data</th>
                    <th colSpan={3} className="text-center px-3 py-1.5 uppercase tracking-wider text-stone-600 border-l border-stone-200">Sistema de apostas</th>
                    <th colSpan={3} className="text-center px-3 py-1.5 uppercase tracking-wider text-stone-600 border-l border-stone-200">Extratos bancários</th>
                    <th colSpan={2} className="text-center px-3 py-1.5 uppercase tracking-wider text-stone-600 border-l border-stone-200">Diferença</th>
                  </tr>
                  <tr className="border-b border-stone-200">
                    <th className="text-right px-3 py-1.5 text-stone-600 border-l border-stone-200">Depósitos</th>
                    <th className="text-right px-3 py-1.5 text-stone-600">Saques</th>
                    <th className="text-right px-3 py-1.5 text-stone-600">Líquido</th>
                    <th className="text-right px-3 py-1.5 text-stone-600 border-l border-stone-200">Depósitos</th>
                    <th className="text-right px-3 py-1.5 text-stone-600">Saques</th>
                    <th className="text-right px-3 py-1.5 text-stone-600">Líquido</th>
                    <th className="text-right px-3 py-1.5 text-stone-600 border-l border-stone-200">Dia</th>
                    <th className="text-right px-3 py-1.5 text-stone-600">Acumulada</th>
                  </tr>
                </thead>
                <tbody>
                  {result.daily_breakdown.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-12 text-center text-stone-500">Sem movimentação no período selecionado.</td></tr>
                  )}
                  {result.daily_breakdown.map(row => {
                    const diffNet = BigInt(row.diff_net);
                    const diffClass = diffNet === 0n ? '' : (diffNet < 0n ? 'text-red-700' : 'text-emerald-700');
                    return (
                      <tr key={row.date} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2 whitespace-nowrap"><Calendar className="w-3 h-3 inline mr-1 text-stone-400" />{formatDate(row.date)}</td>
                        <td className="px-3 py-2 text-right font-mono border-l border-stone-100">{formatBRL(row.sistema_deposits)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatBRL(row.sistema_withdrawals)}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">{formatBRL(row.sistema_net)}</td>
                        <td className="px-3 py-2 text-right font-mono border-l border-stone-100">{formatBRL(row.banco_deposits)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatBRL(row.banco_withdrawals)}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">{formatBRL(row.banco_net)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-medium border-l border-stone-100 ${diffClass}`}>{formatBRL(row.diff_net)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${BigInt(row.cumulative_diff_net) < 0n ? 'text-red-700' : ''}`}>{formatBRL(row.cumulative_diff_net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Pronto para a primeira verificação</h3>
          <p className="text-stone-600 mb-2">Selecione empresa e período acima e clique em "Executar verificação".</p>
          <p className="text-xs text-stone-500">Tolerâncias padrão: 1% para alerta, 5% para crítico (mínimo R$ 100).</p>
        </div>
      )}
    </div>
  );
}
