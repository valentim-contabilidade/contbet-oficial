'use client';

import { useEffect, useState } from 'react';
import { Library } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

interface Item {
  account_id: string; code: string; name: string; type: string; balance: string;
}

interface BalanceSheet {
  assets_total: string;
  liabilities_total: string;
  equity_total: string;
  net_income: string;
  check: string;
  groups: {
    ATIVO: { total: string; items: Item[] };
    PASSIVO: { total: string; items: Item[] };
    PATRIMONIO_LIQUIDO: { total: string; items: Item[] };
  };
  from: string; to: string;
}

function Group({ title, total, items, accentClass }: { title: string; total: string; items: Item[]; accentClass: string }) {
  const visible = items.filter(i => Number(i.balance) !== 0);
  return (
    <div className={`bg-white border ${accentClass} rounded-sm overflow-hidden`}>
      <div className="px-4 py-3 border-b border-inherit flex items-center justify-between bg-stone-50">
        <h3 className="font-display text-lg">{title}</h3>
        <div className="font-mono font-semibold">{formatBRL(total)}</div>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {visible.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-6 text-center text-stone-500 text-xs">Sem saldo no período.</td></tr>
          )}
          {visible.map(i => (
            <tr key={i.account_id} className="border-b border-stone-100">
              <td className="px-4 py-2 font-mono text-xs text-stone-500 w-24">{i.code}</td>
              <td className="px-4 py-2">{i.name}</td>
              <td className={`px-4 py-2 text-right font-mono text-xs ${BigInt(i.balance) < 0n ? 'text-red-700' : ''}`}>{formatBRL(i.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BalanceSheetPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const today = new Date();
  const [from, setFrom] = useState(`${today.getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(todayInput());
  const [bs, setBs] = useState<BalanceSheet | null>(null);
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
    api.get('/accounting/balance-sheet', { params: { company_id: companyId, from, to } })
      .then(r => setBs(r.data))
      .finally(() => setLoading(false));
  }, [companyId, from, to]);

  return (
    <div>
      <PageHeader title="Balanço Patrimonial" subtitle="Posição patrimonial — Ativo, Passivo e Patrimônio Líquido" />

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

      {!loading && bs && (
        <>
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            <Group title="ATIVO" total={bs.assets_total} items={bs.groups.ATIVO.items} accentClass="border-emerald-300" />
            <div className="space-y-6">
              <Group title="PASSIVO" total={bs.liabilities_total} items={bs.groups.PASSIVO.items} accentClass="border-rose-300" />
              <Group title="PATRIMÔNIO LÍQUIDO" total={bs.equity_total} items={bs.groups.PATRIMONIO_LIQUIDO.items} accentClass="border-amber-300" />
              <div className="bg-stone-50 border border-stone-300 rounded-sm p-4">
                <div className="text-xs uppercase tracking-wider text-stone-600 mb-1">Resultado do exercício</div>
                <div className={`font-display text-2xl font-mono ${BigInt(bs.net_income) >= 0n ? 'text-green-700' : 'text-red-700'}`}>
                  {formatBRL(bs.net_income)}
                </div>
                <div className="text-[10px] text-stone-500 mt-1">Receitas − Despesas do período</div>
              </div>
            </div>
          </div>

          <div className="bg-ink text-stone-100 rounded-sm p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-300">Ativo total</div>
              <div className="font-display text-xl text-emerald-300 font-mono">{formatBRL(bs.assets_total)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-300">Passivo + PL + Resultado</div>
              <div className="font-display text-xl text-rose-300 font-mono">
                {formatBRL(String(BigInt(bs.liabilities_total) + BigInt(bs.equity_total) + BigInt(bs.net_income)))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-300">Diferença</div>
              <div className={`font-display text-xl font-mono ${BigInt(bs.check) === 0n ? 'text-gold' : 'text-rose-300'}`}>
                {formatBRL(bs.check)}
              </div>
              <div className="text-[10px] text-stone-400 mt-1">{BigInt(bs.check) === 0n ? '✓ Balanço fecha' : '⚠ Há divergência'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-300">Período</div>
              <div className="text-sm">{new Date(bs.from).toLocaleDateString('pt-BR')} → {new Date(bs.to).toLocaleDateString('pt-BR')}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
