'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, DollarSign, Calculator, Upload, Calendar, Gauge, ArrowRight, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import type { GgrDashboard } from '@/lib/ggr-types';
import type { Brand, Company } from '@/lib/types';

export default function GgrDashboardPage() {
  const { user } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [dashboard, setDashboard] = useState<GgrDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  useEffect(() => {
    api.get('/brands').then(r => setBrands(r.data.data)).catch(() => {});
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: any = { year, month };
    if (selectedCompanyId) params.company_id = selectedCompanyId;
    if (selectedBrandId) params.brand_id = selectedBrandId;
    api.get('/ggr/dashboard', { params })
      .then(r => setDashboard(r.data))
      .catch(() => setDashboard(null))
      .finally(() => setLoading(false));
  }, [selectedCompanyId, selectedBrandId, year, month]);

  // Marcas filtradas pela empresa selecionada
  const visibleBrands = selectedCompanyId
    ? brands.filter(b => b.company_id === selectedCompanyId)
    : brands;

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  if (loading) {
    return <div className="text-center text-stone-500 py-20">Carregando dashboard...</div>;
  }

  const m = dashboard?.current_month;
  const ytd = dashboard?.year_to_date;

  const maxBets = dashboard?.monthly_series.reduce((max, x) => Number(x.bets) > max ? Number(x.bets) : max, 0) || 1;

  return (
    <div>
      <div className="mb-8">
        <div className="text-xs uppercase tracking-widest text-stone-500 mb-2">GGR · Apuração</div>
        <h1 className="font-display text-4xl">Painel GGR & Impostos</h1>
        <p className="text-stone-600 mt-2">Receita bruta de jogo, depósitos, saques e cálculo automático dos impostos da Lei 14.790/2023.</p>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 flex flex-wrap gap-3 items-end">
        {user?.profile === 'ADMIN' && (
          <div>
            <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Empresa</label>
            <select value={selectedCompanyId}
              onChange={e => { setSelectedCompanyId(e.target.value); setSelectedBrandId(''); }}
              className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm">
              <option value="">Todas as empresas</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Marca</label>
          <select value={selectedBrandId} onChange={e => setSelectedBrandId(e.target.value)}
            className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm">
            <option value="">Todas as marcas</option>
            {visibleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Mês</label>
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
            className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')} - {monthNames[m - 1]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Ano</label>
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm w-24" />
        </div>
        <div className="flex-1"></div>
        <Link href="/dashboard/ggr/import"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
          <Upload className="w-4 h-4" /> Importar dados
        </Link>
      </div>

      {/* Cards principais do mês */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200 p-6 rounded-sm">
          <Gauge className="w-5 h-5 text-amber-700 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-amber-800 mb-1">GGR do mês</div>
          <div className="font-display text-3xl text-amber-900">{formatBRL(m?.ggr || 0)}</div>
          <div className="text-xs text-amber-700 mt-2">Apostas − Prêmios</div>
        </div>

        <div className="bg-white border border-stone-200 p-6 rounded-sm">
          <TrendingUp className="w-5 h-5 text-green-600 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Volume de apostas</div>
          <div className="font-display text-3xl">{formatBRL(m?.bets || 0)}</div>
          <div className="text-xs text-stone-500 mt-2">Stakes do mês</div>
        </div>

        <div className="bg-white border border-stone-200 p-6 rounded-sm">
          <TrendingDown className="w-5 h-5 text-red-500 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Prêmios pagos</div>
          <div className="font-display text-3xl">{formatBRL(m?.prizes || 0)}</div>
          <div className="text-xs text-stone-500 mt-2">Payout do mês</div>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-red-100/50 border border-red-200 p-6 rounded-sm">
          <Calculator className="w-5 h-5 text-red-700 mb-4" strokeWidth={1.5} />
          <div className="text-xs uppercase tracking-wider text-red-800 mb-1">Impostos a pagar</div>
          <div className="font-display text-3xl text-red-900">{formatBRL(m?.taxes.total_taxes || 0)}</div>
          <div className="text-xs text-red-700 mt-2">Lei 14.790 + PIS + COFINS</div>
        </div>
      </div>

      {/* Movimento financeiro de jogadores */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Movimento financeiro de jogadores</div>
            <h2 className="font-display text-xl">Carteira dos apostadores</h2>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="border border-stone-200 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wider text-green-700 mb-1">Depósitos</div>
            <div className="font-display text-2xl text-green-700">{formatBRL(m?.deposits || 0)}</div>
          </div>
          <div className="border border-stone-200 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wider text-red-700 mb-1">Saques</div>
            <div className="font-display text-2xl text-red-700">{formatBRL(m?.withdrawals || 0)}</div>
          </div>
          <div className="border border-stone-200 rounded-sm p-4 bg-stone-50">
            <div className="text-xs uppercase tracking-wider text-stone-700 mb-1">Saldo líquido (carteira)</div>
            <div className={`font-display text-2xl ${Number(m?.deposits || 0) - Number(m?.withdrawals || 0) >= 0 ? 'text-stone-800' : 'text-red-700'}`}>
              {formatBRL(Number(m?.deposits || 0) - Number(m?.withdrawals || 0))}
            </div>
          </div>
        </div>
      </div>

      {/* Detalhamento dos impostos */}
      {m?.taxes && (
        <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Apuração tributária</div>
            <h2 className="font-display text-xl">Impostos calculados sobre {monthNames[month - 1]}/{year}</h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="border border-blue-200 bg-blue-50/30 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-blue-800 mb-1">Lei 14.790 (13%)</div>
              <div className="font-display text-xl text-blue-900">{formatBRL(m.taxes.tax_lei14790_amount)}</div>
              <div className="text-xs text-blue-700 mt-1">Sobre receita líquida</div>
            </div>
            <div className="border border-amber-200 bg-amber-50/30 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-amber-800 mb-1">PIS (0,65%)</div>
              <div className="font-display text-xl text-amber-900">{formatBRL(m.taxes.pis_amount)}</div>
              <div className="text-xs text-amber-700 mt-1">Sobre receita</div>
            </div>
            <div className="border border-rose-200 bg-rose-50/30 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-rose-800 mb-1">COFINS (3%)</div>
              <div className="font-display text-xl text-rose-900">{formatBRL(m.taxes.cofins_amount)}</div>
              <div className="text-xs text-rose-700 mt-1">Sobre receita</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-stone-200 flex items-center justify-between">
            <div className="text-sm text-stone-600">
              💡 Os valores são <strong>estimativas</strong> baseadas nos dados importados. Para apuração definitiva, vá em "Apurações mensais" e clique em "Fechar apuração" — o sistema vai gerar automaticamente as contas a pagar dos impostos.
            </div>
            {selectedBrandId && (
              <Link href={`/dashboard/ggr/monthly/${selectedBrandId}/${year}/${month}`}
                className="ml-4 inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition whitespace-nowrap">
                Ver apuração <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Gráfico anual */}
      {dashboard && dashboard.monthly_series.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm p-6">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Evolução anual</div>
            <h2 className="font-display text-xl">GGR mensal de {dashboard.year}</h2>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="flex items-end gap-2 h-64 mb-4 pb-2 border-b border-stone-200">
                {dashboard.monthly_series.map((m, i) => {
                  const bets = Number(m.bets);
                  const prizes = Number(m.prizes);
                  const ggr = Number(m.ggr);
                  const heightBets = maxBets > 0 ? (bets / maxBets) * 100 : 0;
                  const heightPrizes = maxBets > 0 ? (prizes / maxBets) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center group relative">
                      <div className="w-full flex gap-0.5 items-end h-56">
                        <div className="flex-1 bg-amber-400/70 hover:bg-amber-500 transition rounded-t-sm relative" style={{ height: `${heightBets}%` }}
                             title={`Apostas: ${formatBRL(bets)}`}></div>
                        <div className="flex-1 bg-red-400/70 hover:bg-red-500 transition rounded-t-sm" style={{ height: `${heightPrizes}%` }}
                             title={`Prêmios: ${formatBRL(prizes)}`}></div>
                      </div>
                      <div className="text-xs text-stone-500 mt-2">{monthNames[i]}</div>
                      <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition bg-ink text-stone-100 text-xs px-2 py-1 rounded-sm whitespace-nowrap pointer-events-none">
                        GGR: {formatBRL(ggr)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-6 text-xs text-stone-600 justify-center pt-2">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-400/70 rounded-sm"></div>Apostas</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-400/70 rounded-sm"></div>Prêmios</div>
                <div className="text-stone-400">·</div>
                <div className="text-stone-500">passe o mouse sobre os meses para ver o GGR</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sem dados */}
      {(!dashboard || Number(m?.bets || 0) === 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-6 mt-6 flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-900 mb-1">Sem dados para esse período</h3>
            <p className="text-sm text-amber-800 mb-3">Não foram encontrados registros de GGR para {monthNames[month - 1]}/{year}. Importe os dados operacionais para começar.</p>
            <Link href="/dashboard/ggr/import" className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-700 text-white text-xs rounded-sm hover:bg-amber-800 transition">
              <Upload className="w-3.5 h-3.5" /> Importar dados
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
