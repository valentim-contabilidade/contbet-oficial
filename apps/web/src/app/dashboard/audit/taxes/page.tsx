'use client';

import { useEffect, useState } from 'react';
import { Calculator, AlertTriangle, ShieldCheck, ShieldX, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select, PrimaryButton } from '@/components/ui';
import type { Company } from '@/lib/types';

type AlertLevel = 'OK' | 'WARNING' | 'CRITICAL';

interface TaxItem {
  apuration_id: string;
  period_label: string;
  calculated: string;
  paid: string;
  diff: string;
  payable_ids: string[];
}
interface TaxBucket {
  type: string;
  calculated: string;
  paid: string;
  diff: string;
  items: TaxItem[];
}

interface CheckResult {
  check_id: string;
  created_at: string;
  from: string; to: string;
  totals: { calculated: string; paid: string; diff: string };
  per_tax_breakdown: TaxBucket[];
  alert_level: AlertLevel;
  has_data: boolean;
}

const alertConfig: Record<AlertLevel, { label: string; bg: string; text: string; border: string; Icon: any }> = {
  OK: { label: 'Tributos calculados batem com os pagos', bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300', Icon: ShieldCheck },
  WARNING: { label: 'Atenção · divergência acima de 1% do calculado', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', Icon: AlertTriangle },
  CRITICAL: { label: 'Crítico · divergência acima de 5% do calculado', bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', Icon: ShieldX },
};

export default function TaxesAuditPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`);
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
      const res = await api.post('/audit/taxes-check', { company_id: companyId, from, to });
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
        title="Auditoria · Tributos × DARFs"
        subtitle="Compara o tributo calculado nas apurações fechadas com o efetivamente pago via Conta a Pagar (DARF)"
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

      {result && alert && (
        <>
          <div className={`${alert.bg} ${alert.text} border ${alert.border} rounded-sm p-5 mb-6 flex items-start gap-4`}>
            <AlertIcon className="w-7 h-7 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider mb-1">Resultado</div>
              <div className="font-display text-xl">{alert.label}</div>
              <div className="text-xs mt-1 opacity-80">
                Período {formatDate(result.from)} até {formatDate(result.to)} · executada em {new Date(result.created_at).toLocaleString('pt-BR')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider opacity-80">Diferença total</div>
              <div className="font-display text-2xl font-mono">{formatBRL(result.totals.diff)}</div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Total calculado</div>
              <div className="font-display text-2xl font-mono text-amber-800">{formatBRL(result.totals.calculated)}</div>
              <div className="text-[11px] text-stone-500 mt-2">Soma dos tributos das apurações fechadas no período.</div>
            </div>
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Total pago</div>
              <div className="font-display text-2xl font-mono text-green-800">{formatBRL(result.totals.paid)}</div>
              <div className="text-[11px] text-stone-500 mt-2">Soma dos pagamentos efetivados (Contas a Pagar com origem Apuração).</div>
            </div>
            <div className="bg-ink text-stone-100 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-300 mb-2">Diferença (pago − calculado)</div>
              <div className={`font-display text-2xl font-mono ${BigInt(result.totals.diff) === 0n ? 'text-gold' : (BigInt(result.totals.diff) < 0n ? 'text-rose-300' : 'text-emerald-300')}`}>
                {formatBRL(result.totals.diff)}
              </div>
              <div className="text-[11px] text-stone-300 mt-2 leading-tight">
                Negativo = pagou menos que devia (risco fiscal).<br />
                Positivo = pagou a mais (provavelmente erro de classificação).
              </div>
            </div>
          </div>

          {result.per_tax_breakdown.length > 0 ? (
            <div className="space-y-4">
              {result.per_tax_breakdown.map(b => (
                <div key={b.type} className="bg-white border border-stone-200 rounded-sm overflow-hidden">
                  <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="font-display text-lg flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-amber-700" /> {b.type}
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-stone-600">Calculado: <strong className="font-mono ml-1">{formatBRL(b.calculated)}</strong></span>
                      <span className="text-stone-600">Pago: <strong className="font-mono ml-1">{formatBRL(b.paid)}</strong></span>
                      <span className={`font-medium ${BigInt(b.diff) === 0n ? 'text-stone-700' : BigInt(b.diff) < 0n ? 'text-red-700' : 'text-emerald-700'}`}>
                        Diff: <span className="font-mono ml-1">{formatBRL(b.diff)}</span>
                      </span>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 border-b border-stone-200">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Período</th>
                        <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Calculado</th>
                        <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Pago</th>
                        <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.items.map(it => (
                        <tr key={`${b.type}-${it.apuration_id}`} className="border-b border-stone-100">
                          <td className="px-4 py-2 font-mono">{it.period_label}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatBRL(it.calculated)}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatBRL(it.paid)}</td>
                          <td className={`px-4 py-2 text-right font-mono font-medium ${BigInt(it.diff) === 0n ? '' : BigInt(it.diff) < 0n ? 'text-red-700' : 'text-emerald-700'}`}>
                            {formatBRL(it.diff)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-sm p-8 text-center text-stone-500">
              Nenhuma apuração fechada no período.
            </div>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Calculator className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Auditoria de tributos × DARFs pagos</h3>
          <p className="text-stone-600 mb-2">Para cada apuração fechada no período (IRPJ, CSLL, PIS, COFINS, ISS, Lei 14.790), compara o valor calculado com o pago via Conta a Pagar.</p>
          <p className="text-xs text-stone-500">Tolerâncias: 1% WARNING, 5% CRITICAL (mínimo R$ 100).</p>
        </div>
      )}
    </div>
  );
}
