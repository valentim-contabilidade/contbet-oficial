'use client';

import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

interface Row {
  account_id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parent_id: string | null;
  debit: string;
  credit: string;
  balance: string;
  natural_side: 'D' | 'C';
}

const typeLabels: Record<string, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio Líquido',
  REVENUE: 'Receita',
  EXPENSE: 'Despesa',
};

const typeColors: Record<string, string> = {
  ASSET: 'text-emerald-700',
  LIABILITY: 'text-rose-700',
  EQUITY: 'text-amber-700',
  REVENUE: 'text-sky-700',
  EXPENSE: 'text-red-700',
};

export default function TrialBalancePage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(todayInput());
  const [data, setData] = useState<{ rows: Row[]; total_debit: string; total_credit: string } | null>(null);
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
    api.get('/accounting/trial-balance', { params: { company_id: companyId, from, to } })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [companyId, from, to]);

  // Filtra contas que tiveram movimento ou que são analíticas com saldo (oculta sintéticas zeradas)
  const visibleRows = (data?.rows ?? []).filter(r => Number(r.debit) !== 0 || Number(r.credit) !== 0);

  return (
    <div>
      <PageHeader title="Balancete" subtitle="Movimentação contábil consolidada por conta no período" />

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-3 gap-3">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
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

      {!loading && data && visibleRows.length === 0 && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Scale className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhum lançamento no período</h3>
          <p className="text-stone-600">Ajuste o período ou registre lançamentos contábeis para começar.</p>
        </div>
      )}

      {!loading && data && visibleRows.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Código</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Débito</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Crédito</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr key={r.account_id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2.5 font-mono text-xs">{r.code}</td>
                    <td className="px-4 py-2.5">{r.name}</td>
                    <td className={`px-4 py-2.5 text-xs uppercase tracking-wider ${typeColors[r.type]}`}>{typeLabels[r.type]}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatBRL(r.debit)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatBRL(r.credit)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium ${BigInt(r.balance) < 0n ? 'text-red-700' : ''}`}>
                      {formatBRL(r.balance)} <span className="text-[10px] text-stone-400">{r.natural_side}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-stone-50 border-t-2 border-stone-300">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-xs uppercase tracking-wider text-stone-700 font-medium">Totais</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(data.total_debit)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(data.total_credit)}</td>
                  <td className="px-4 py-3 text-right">
                    {data.total_debit === data.total_credit
                      ? <span className="text-xs text-green-700">✓ Balanceado</span>
                      : <span className="text-xs text-red-700">⚠ Diferença {formatBRL(String(BigInt(data.total_debit) - BigInt(data.total_credit)))}</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
