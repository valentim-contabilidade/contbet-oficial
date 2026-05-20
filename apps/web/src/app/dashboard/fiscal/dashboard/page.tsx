'use client';

import { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Receipt, TrendingDown, TrendingUp, Users, FileText, Coins } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import { PageHeader, FilterBar } from '@/components/ui';
import { formatBRL, formatDocument } from '@/lib/format';

interface DashboardData {
  totals: {
    total_entrada: string; total_saida: string;
    iss_retido: string; irrf_retido: string; inss_retido: string;
    pis_retido: string; cofins_retido: string; csll_retido: string;
    notas_entrada: number; notas_saida: number;
    nfse_entrada: number; nfe_entrada: number; nfse_saida: number;
  };
  by_month: Array<{
    month: string;
    entrada: number; saida: number;
    iss_retido: number; irrf_retido: number; inss_retido: number;
    notas_entrada: number; notas_saida: number;
  }>;
  top_suppliers: Array<{ cnpj: string; name: string; total: string; count: number }>;
}

const formatMonthLabel = (yyyymm: string) => {
  const [y, m] = yyyymm.split('-');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[Number(m) - 1]}/${y.slice(2)}`;
};

export default function FiscalDashboardPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/companies').then(r => setCompanies(r.data.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get('/fiscal/dashboard', { params: filters })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [filters]);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  // Escala do gráfico — pega o maior valor entre entrada e saida pra normalizar barras
  const maxValue = data ? Math.max(...data.by_month.map(m => Math.max(m.entrada, m.saida)), 1) : 1;

  return (
    <div>
      <PageHeader title="Dashboard Fiscal" subtitle="Últimos 12 meses · NFSe e NFe sincronizadas" />

      <FilterBar
        filters={[
          { key: 'company_id', label: 'Empresa', type: 'select', options: companies.map(c => ({ value: c.id, label: c.name })) },
        ]}
        values={filters} onChange={setFilters}
      />

      {loading && <div className="text-center text-stone-500 py-12">Carregando…</div>}

      {!loading && data && (
        <>
          {/* KPIs principais */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              title="Entrada (12m)"
              value={formatBRL(data.totals.total_entrada)}
              subtitle={`${data.totals.notas_entrada} notas · ${data.totals.nfse_entrada} NFSe + ${data.totals.nfe_entrada} NFe`}
              icon={<ArrowDownCircle className="w-5 h-5 text-green-700" />}
              accent="green"
            />
            <KpiCard
              title="Saída (12m)"
              value={formatBRL(data.totals.total_saida)}
              subtitle={`${data.totals.notas_saida} notas`}
              icon={<ArrowUpCircle className="w-5 h-5 text-blue-700" />}
              accent="blue"
            />
            <KpiCard
              title="ISS retido"
              value={formatBRL(data.totals.iss_retido)}
              subtitle="Imposto sobre Serviços"
              icon={<Coins className="w-5 h-5 text-amber-700" />}
              accent="amber"
            />
            <KpiCard
              title="IRRF retido"
              value={formatBRL(data.totals.irrf_retido)}
              subtitle="Imposto de Renda Retido"
              icon={<Coins className="w-5 h-5 text-purple-700" />}
              accent="purple"
            />
          </div>

          {/* Outros impostos */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <SmallStat label="INSS retido" value={formatBRL(data.totals.inss_retido)} />
            <SmallStat label="PIS retido" value={formatBRL(data.totals.pis_retido)} />
            <SmallStat label="COFINS retido" value={formatBRL(data.totals.cofins_retido)} />
            <SmallStat label="CSLL retido" value={formatBRL(data.totals.csll_retido)} />
          </div>

          {/* Gráfico mensal — barras ASCII estilizadas */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <h2 className="font-display text-xl mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-stone-500" /> Evolução mensal
            </h2>
            <div className="space-y-3">
              {data.by_month.map(m => {
                const entradaPct = (m.entrada / maxValue) * 100;
                const saidaPct = (m.saida / maxValue) * 100;
                return (
                  <div key={m.month} className="grid grid-cols-12 gap-3 items-center text-xs">
                    <div className="col-span-1 text-stone-600 font-mono">{formatMonthLabel(m.month)}</div>
                    <div className="col-span-9 space-y-1">
                      {m.entrada > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-16 text-green-700 text-[10px] uppercase tracking-wider">Entrada</div>
                          <div className="flex-1 bg-stone-100 rounded-sm h-5 relative overflow-hidden">
                            <div className="bg-green-600 h-full" style={{ width: `${entradaPct}%` }} />
                          </div>
                          <div className="w-28 text-right font-mono text-stone-700">{formatBRL(m.entrada * 100)}</div>
                        </div>
                      )}
                      {m.saida > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-16 text-blue-700 text-[10px] uppercase tracking-wider">Saída</div>
                          <div className="flex-1 bg-stone-100 rounded-sm h-5 relative overflow-hidden">
                            <div className="bg-blue-600 h-full" style={{ width: `${saidaPct}%` }} />
                          </div>
                          <div className="w-28 text-right font-mono text-stone-700">{formatBRL(m.saida * 100)}</div>
                        </div>
                      )}
                      {m.entrada === 0 && m.saida === 0 && (
                        <div className="text-stone-400 text-[10px]">— sem notas no período</div>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-stone-500">
                      {m.notas_entrada + m.notas_saida > 0 && (
                        <span>{m.notas_entrada + m.notas_saida} notas</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top fornecedores */}
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
            <div className="px-5 py-4 bg-stone-50 border-b border-stone-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-stone-500" />
              <h2 className="font-display text-lg">Top fornecedores (entrada · 12 meses)</h2>
            </div>
            {data.top_suppliers.length === 0 ? (
              <div className="p-8 text-center text-stone-500 text-sm">Nenhum fornecedor encontrado.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">#</th>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Fornecedor</th>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">CNPJ</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Notas</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_suppliers.map((s, i) => (
                    <tr key={s.cnpj} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                      <td className="px-4 py-2.5 text-stone-500">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name || '—'}</td>
                      <td className="px-4 py-2.5 text-stone-600 font-mono text-xs">{formatDocument(s.cnpj)}</td>
                      <td className="px-4 py-2.5 text-right text-stone-700">{s.count}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatBRL(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon, accent }: {
  title: string; value: string; subtitle: string; icon: React.ReactNode;
  accent: 'green' | 'blue' | 'amber' | 'purple';
}) {
  const accentClasses = {
    green: 'border-l-green-500 bg-green-50/30',
    blue: 'border-l-blue-500 bg-blue-50/30',
    amber: 'border-l-amber-500 bg-amber-50/30',
    purple: 'border-l-purple-500 bg-purple-50/30',
  };
  return (
    <div className={`bg-white border border-stone-200 border-l-4 rounded-sm p-4 ${accentClasses[accent]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-stone-600">{title}</span>
        {icon}
      </div>
      <div className="font-display text-2xl">{value}</div>
      <div className="text-xs text-stone-500 mt-1">{subtitle}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-sm p-3">
      <div className="text-xs uppercase tracking-wider text-stone-600 mb-1">{label}</div>
      <div className="font-mono text-lg text-stone-800">{value}</div>
    </div>
  );
}
