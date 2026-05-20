'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Receipt, AlertTriangle, ShieldCheck, ShieldX, Play, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select, PrimaryButton } from '@/components/ui';
import type { Company } from '@/lib/types';

type AlertLevel = 'OK' | 'WARNING' | 'CRITICAL';

interface AccountBreakdown {
  account_id: string;
  account_name: string;
  fee_per_credit: string;
  fee_per_debit: string;
  deposits_count: number;
  withdrawals_count: number;
  expected_fees: string;
}

interface CheckResult {
  check_id: string;
  created_at: string;
  from: string; to: string;
  sistema: { deposits_count: number; withdrawals_count: number };
  rates: { avg_fee_per_credit: string; avg_fee_per_debit: string };
  expected: { credit_fees: string; debit_fees: string; total_fees: string };
  actual: { total_fees: string };
  diff: { total_fees: string };
  alert_level: AlertLevel;
  per_account_breakdown: AccountBreakdown[];
  missing_player_account: boolean;
  missing_rates: boolean;
}

const alertConfig: Record<AlertLevel, { label: string; bg: string; text: string; border: string; Icon: any }> = {
  OK: { label: 'Tarifas batem com o esperado', bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300', Icon: ShieldCheck },
  WARNING: { label: 'Atenção · divergência acima de 1% do esperado', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', Icon: AlertTriangle },
  CRITICAL: { label: 'Crítico · divergência acima de 5% do esperado', bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', Icon: ShieldX },
};

export default function FeesAuditPage() {
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
      const res = await api.post('/audit/fees-check', { company_id: companyId, from, to });
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
        title="Auditoria · Tarifas Bancárias"
        subtitle="Compara as tarifas esperadas (qtd transações × taxa contratada) com as efetivamente cobradas pelo banco"
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
            {' '}<Link href="/dashboard/financial/bank-accounts" className="underline font-medium">Contas Bancárias</Link>{' '}
            e marque as contas operacionais relevantes.
          </div>
        </div>
      )}

      {result && !result.missing_player_account && result.missing_rates && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 mb-6 flex items-start gap-3">
          <Settings className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <strong>Taxas bancárias não configuradas.</strong> Sem isso o sistema não consegue calcular o esperado.
            Edite as contas em
            {' '}<Link href="/dashboard/financial/bank-accounts" className="underline font-medium">Contas Bancárias</Link>{' '}
            e abra a seção <em>"Taxas bancárias contratadas"</em> para informar o valor por crédito e por débito.
          </div>
        </div>
      )}

      {result && alert && (
        <>
          {/* Banner de status */}
          <div className={`${alert.bg} ${alert.text} border ${alert.border} rounded-sm p-5 mb-6 flex items-start gap-4`}>
            <AlertIcon className="w-7 h-7 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider mb-1">Resultado da auditoria</div>
              <div className="font-display text-xl">{alert.label}</div>
              <div className="text-xs mt-1 opacity-80">
                Período {formatDate(result.from)} até {formatDate(result.to)} · executada em {new Date(result.created_at).toLocaleString('pt-BR')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider opacity-80">Diferença total</div>
              <div className="font-display text-2xl font-mono">{formatBRL(result.diff.total_fees)}</div>
            </div>
          </div>

          {/* Cards: sistema · esperado · cobrado · diferença */}
          <div className="grid sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Volume (sistema)</div>
              <div className="text-xs text-stone-600">Depósitos</div>
              <div className="font-mono font-medium">{result.sistema.deposits_count.toLocaleString('pt-BR')}</div>
              <div className="text-xs text-stone-600 mt-2">Saques</div>
              <div className="font-mono font-medium">{result.sistema.withdrawals_count.toLocaleString('pt-BR')}</div>
              <div className="border-t border-stone-200 mt-3 pt-2">
                <div className="text-xs text-stone-600">Total transações</div>
                <div className="font-display text-xl font-mono">{(result.sistema.deposits_count + result.sistema.withdrawals_count).toLocaleString('pt-BR')}</div>
              </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Tarifas esperadas</div>
              <div className="text-xs text-stone-600">Sobre depósitos</div>
              <div className="font-mono font-medium">{formatBRL(result.expected.credit_fees)}</div>
              <div className="text-xs text-stone-600 mt-2">Sobre saques</div>
              <div className="font-mono font-medium">{formatBRL(result.expected.debit_fees)}</div>
              <div className="border-t border-stone-200 mt-3 pt-2">
                <div className="text-xs text-stone-600">Total esperado</div>
                <div className="font-display text-xl font-mono text-amber-800">{formatBRL(result.expected.total_fees)}</div>
              </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Tarifas cobradas (extrato)</div>
              <div className="text-xs text-stone-600">Detectadas por padrão "TARIFA"</div>
              <div className="font-display text-2xl font-mono mt-1 text-red-700">{formatBRL(result.actual.total_fees)}</div>
              <div className="text-[11px] text-stone-500 mt-2 leading-tight">
                Detecção automática nos extratos. Se 0, classifique manualmente as linhas de tarifa em Conciliação.
              </div>
            </div>

            <div className="bg-ink text-stone-100 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-300 mb-2">Diferença</div>
              <div className={`font-display text-3xl font-mono ${BigInt(result.diff.total_fees) === 0n ? 'text-gold' : (BigInt(result.diff.total_fees) > 0n ? 'text-rose-300' : 'text-emerald-300')}`}>
                {formatBRL(result.diff.total_fees)}
              </div>
              <div className="text-[11px] text-stone-300 mt-2 leading-tight">
                Cobrado − Esperado.<br />
                Positivo = banco cobrou a mais.<br />
                Negativo = banco cobrou a menos.
              </div>
            </div>
          </div>

          {/* Detalhamento por conta */}
          {result.per_account_breakdown.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-200">
                <div className="text-xs uppercase tracking-wider text-stone-700 font-medium">Detalhamento por conta auditada</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 border-b border-stone-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                      <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Taxa crédito</th>
                      <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Taxa débito</th>
                      <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Depósitos</th>
                      <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Saques</th>
                      <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Tarifa esperada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.per_account_breakdown.map(a => (
                      <tr key={a.account_id} className="border-b border-stone-100">
                        <td className="px-4 py-2">{a.account_name}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatBRL(a.fee_per_credit)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatBRL(a.fee_per_debit)}</td>
                        <td className="px-4 py-2 text-right font-mono">{a.deposits_count.toLocaleString('pt-BR')}</td>
                        <td className="px-4 py-2 text-right font-mono">{a.withdrawals_count.toLocaleString('pt-BR')}</td>
                        <td className="px-4 py-2 text-right font-mono font-medium">{formatBRL(a.expected_fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-xs text-stone-500 border-t border-stone-200 bg-stone-50">
                💡 Quando o sistema não tem como saber por qual conta passou cada transação, distribui igualmente. Para precisão por conta, precisamos de mapeamento marca → conta (próxima evolução).
              </div>
            </div>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Receipt className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Auditoria de tarifas bancárias</h3>
          <p className="text-stone-600 mb-2">Compara as tarifas que <strong>deveriam ser cobradas</strong> (com base nas taxas contratadas e no volume de transações) com o que <strong>foi efetivamente cobrado</strong> nos extratos.</p>
          <p className="text-xs text-stone-500">Antes de executar, certifique-se de ter cadastrado as taxas em Contas Bancárias.</p>
        </div>
      )}
    </div>
  );
}
