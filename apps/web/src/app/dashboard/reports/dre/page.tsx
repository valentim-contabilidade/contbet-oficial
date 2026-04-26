'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, PieChart, BarChart3, Calendar, Building2, Filter, ArrowUp, ArrowDown, Minus, Info, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import type { DreResponse, PeriodType, DreLine, ExpenseByCategory } from '@/lib/dre-types';
import type { Company, Brand } from '@/lib/types';

// Paleta para o gráfico de pizza (caso a categoria não tenha cor própria)
const CHART_COLORS = ['#0a1f1c', '#c9a961', '#7c2d12', '#3f6212', '#1e3a8a', '#7c3aed', '#be185d', '#0891b2', '#a16207', '#374151'];

function formatPercent(p: number | null | undefined, decimals = 1): string {
  if (p === null || p === undefined) return '—';
  return `${p > 0 ? '+' : ''}${p.toFixed(decimals)}%`;
}

function VariationBadge({ value, inverted = false }: { value: number | null; inverted?: boolean }) {
  if (value === null || value === undefined) return <span className="text-stone-400 text-xs">—</span>;

  // inverted=true para despesas: aumento = ruim (vermelho)
  const isPositive = inverted ? value < 0 : value > 0;
  const isNegative = inverted ? value > 0 : value < 0;
  const isZero = Math.abs(value) < 0.01;

  if (isZero) {
    return <span className="inline-flex items-center gap-0.5 text-xs text-stone-500"><Minus className="w-3 h-3" /> 0%</span>;
  }
  if (isPositive) {
    return <span className="inline-flex items-center gap-0.5 text-xs text-green-700 font-medium"><ArrowUp className="w-3 h-3" /> {formatPercent(Math.abs(value))}</span>;
  }
  if (isNegative) {
    return <span className="inline-flex items-center gap-0.5 text-xs text-red-700 font-medium"><ArrowDown className="w-3 h-3" /> {formatPercent(Math.abs(value))}</span>;
  }
  return <span className="text-xs text-stone-500">—</span>;
}

/** Componente de linha da DRE (com indentação e formatação por nível) */
function DreLineRow({ line }: { line: DreLine }) {
  const isTotal = line.is_total;
  const indent = (line.level ?? 0) * 16;
  const amountColor = line.is_negative ? 'text-red-700' : Number(line.amount) > 0 ? 'text-stone-900' : Number(line.amount) < 0 ? 'text-red-700' : 'text-stone-500';

  return (
    <tr className={`${isTotal ? 'bg-stone-50 border-t-2 border-stone-300 font-medium' : 'border-b border-stone-100 hover:bg-stone-50/50'}`}>
      <td className={`px-4 py-2.5 ${isTotal ? 'font-display' : ''}`}>
        <span style={{ paddingLeft: `${indent}px` }} className="inline-block">
          {isTotal ? <span className="uppercase tracking-wider text-xs">{line.label}</span> : line.label}
        </span>
      </td>
      <td className={`px-4 py-2.5 text-right font-mono ${isTotal ? 'text-base' : 'text-sm'} ${amountColor}`}>
        {line.is_negative ? '−' : ''}{formatBRL(line.amount)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-500">
        {line.is_negative ? '−' : ''}{formatBRL(line.amount_previous)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <VariationBadge value={line.variation_percent} inverted={line.is_negative} />
      </td>
    </tr>
  );
}

/** Gráfico de pizza simples em SVG puro */
function ExpensesPieChart({ items }: { items: ExpenseByCategory[] }) {
  if (items.length === 0) {
    return <div className="text-center text-stone-500 py-12 text-sm">Sem despesas no período.</div>;
  }

  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  if (total === 0) return <div className="text-center text-stone-500 py-12 text-sm">Sem despesas no período.</div>;

  const radius = 90;
  const cx = 100;
  const cy = 100;
  let cumulativeAngle = -Math.PI / 2; // começa no topo

  const slices = items.map((item, i) => {
    const value = Number(item.amount);
    const angle = (value / total) * Math.PI * 2;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle = endAngle;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    const color = item.category_color || CHART_COLORS[i % CHART_COLORS.length];

    return { path, color, label: item.category_name, value, percent: item.percent_of_total ?? 0 };
  });

  return (
    <div className="flex flex-wrap gap-6 items-center justify-center">
      <svg viewBox="0 0 200 200" className="w-48 h-48 flex-shrink-0">
        {slices.map((slice, i) => (
          <path key={i} d={slice.path} fill={slice.color} stroke="white" strokeWidth="1.5">
            <title>{slice.label}: {formatBRL(slice.value)} ({(slice.percent ?? 0).toFixed(1)}%)</title>
          </path>
        ))}
      </svg>
      <div className="flex-1 min-w-0 max-w-md space-y-1.5">
        {slices.slice(0, 8).map((slice, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: slice.color }}></div>
            <div className="flex-1 truncate text-stone-700">{slice.label}</div>
            <div className="font-mono text-stone-900">{formatBRL(slice.value)}</div>
            <div className="font-mono text-stone-500 w-12 text-right">{(slice.percent ?? 0).toFixed(1)}%</div>
          </div>
        ))}
        {slices.length > 8 && (
          <div className="text-xs text-stone-500 italic pt-1">+ {slices.length - 8} outras categorias</div>
        )}
      </div>
    </div>
  );
}

/** Gráfico de linha dos últimos 12 meses */
function MonthlyChart({ data }: { data: DreResponse['monthly_series'] }) {
  if (!data.length) return null;

  const revenues = data.map(d => Number(d.revenue));
  const profits = data.map(d => Number(d.profit));
  const max = Math.max(...revenues, ...profits);
  const min = Math.min(0, ...profits);
  const range = max - min;

  const width = 600;
  const height = 200;
  const padding = { top: 10, right: 10, bottom: 30, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const xStep = innerWidth / (data.length - 1 || 1);
  const yScale = (v: number) => padding.top + innerHeight - ((v - min) / (range || 1)) * innerHeight;
  const xPos = (i: number) => padding.left + i * xStep;

  const revenuePath = revenues.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yScale(v)}`).join(' ');
  const profitPath = profits.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yScale(v)}`).join(' ');

  // Linha do zero (se aplicável)
  const zeroY = yScale(0);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[600px] w-full">
        {/* Grade horizontal */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = padding.top + innerHeight * t;
          return <line key={t} x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e7e5e4" strokeDasharray="2 2" />;
        })}

        {/* Linha do zero (se passa pela área) */}
        {min < 0 && (
          <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#a8a29e" strokeWidth="1" />
        )}

        {/* Linha de receita (dourado) */}
        <path d={revenuePath} fill="none" stroke="#c9a961" strokeWidth="2.5" />
        {revenues.map((v, i) => (
          <circle key={`r${i}`} cx={xPos(i)} cy={yScale(v)} r="3" fill="#c9a961">
            <title>{data[i].label}: Receita {formatBRL(v)}</title>
          </circle>
        ))}

        {/* Linha de lucro (verde-petróleo) */}
        <path d={profitPath} fill="none" stroke="#0a1f1c" strokeWidth="2.5" strokeDasharray="0" />
        {profits.map((v, i) => (
          <circle key={`p${i}`} cx={xPos(i)} cy={yScale(v)} r="3" fill="#0a1f1c">
            <title>{data[i].label}: Lucro {formatBRL(v)}</title>
          </circle>
        ))}

        {/* Labels eixo X */}
        {data.map((d, i) => (
          <text key={i} x={xPos(i)} y={height - 10} textAnchor="middle" fontSize="10" fill="#78716c">
            {d.label}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-6 text-xs text-stone-600 justify-center pt-3">
        <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-gold"></div>Receita Bruta</div>
        <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-ink"></div>Lucro</div>
        <div className="text-stone-400">·</div>
        <div className="text-stone-500">passe o mouse sobre os pontos para ver valores</div>
      </div>
    </div>
  );
}

export default function DrePage() {
  const { user } = useAuth();
  const today = new Date();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [brandId, setBrandId] = useState<string>('');
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.floor(today.getMonth() / 3) + 1);

  const [data, setData] = useState<DreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) {
        setCompanyId(user.company_id);
      } else if (r.data.data.length > 0) {
        setCompanyId(r.data.data[0].id);
      }
    });
  }, [user]);

  useEffect(() => {
    if (companyId) {
      api.get('/brands', { params: { company_id: companyId } })
        .then(r => setBrands(r.data.data))
        .catch(() => setBrands([]));
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    const params: any = { company_id: companyId, period_type: periodType, year };
    if (brandId) params.brand_id = brandId;
    if (periodType === 'monthly') params.month = month;
    if (periodType === 'quarterly') params.quarter = quarter;

    api.get('/reports/dre', { params })
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.message || 'Erro ao carregar DRE'))
      .finally(() => setLoading(false));
  }, [companyId, brandId, periodType, year, month, quarter]);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div className="print:p-0">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4 print:mb-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Relatório · DRE Gerencial</div>
          <h1 className="font-display text-4xl">Demonstração do Resultado</h1>
          <p className="text-stone-600 mt-2">Apuração consolidada cruzando GGR, despesas, impostos e tributos</p>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-stone-100 hover:bg-stone-200 rounded-sm transition print:hidden">
          <Printer className="w-4 h-4" /> Imprimir / PDF
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 print:hidden">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-stone-400" />
          <span className="text-xs uppercase tracking-wider text-stone-700 font-medium">Filtros</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <div className="lg:col-span-2">
            <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Empresa</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}
              disabled={user?.profile === 'MANAGER'}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink">
              <option value="">Selecione...</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Marca (opcional)</label>
            <select value={brandId} onChange={e => setBrandId(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink">
              <option value="">Todas</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Ano</label>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value) || today.getFullYear())}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink" />
          </div>
        </div>

        {/* Botões de tipo de período */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setPeriodType('monthly')}
            className={`px-3 py-1.5 rounded-sm text-sm border transition ${periodType === 'monthly' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
            Mensal
          </button>
          <button onClick={() => setPeriodType('quarterly')}
            className={`px-3 py-1.5 rounded-sm text-sm border transition ${periodType === 'quarterly' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
            Trimestral
          </button>
          <button onClick={() => setPeriodType('yearly')}
            className={`px-3 py-1.5 rounded-sm text-sm border transition ${periodType === 'yearly' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
            Anual
          </button>
        </div>

        {/* Sub-filtro mensal/trimestral */}
        {periodType === 'monthly' && (
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <button key={m} onClick={() => setMonth(m)}
                className={`px-3 py-1 rounded-sm text-xs border transition ${month === m ? 'bg-gold text-ink border-gold font-medium' : 'bg-white border-stone-300 hover:border-ink'}`}>
                {monthNames[m - 1]}
              </button>
            ))}
          </div>
        )}
        {periodType === 'quarterly' && (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map(q => (
              <button key={q} onClick={() => setQuarter(q)}
                className={`px-3 py-1.5 rounded-sm text-xs border transition ${quarter === q ? 'bg-gold text-ink border-gold font-medium' : 'bg-white border-stone-300 hover:border-ink'}`}>
                {q}º Trimestre
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="text-center text-stone-500 py-20">Calculando DRE...</div>}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-sm p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && data && (
        <>
          {/* Cabeçalho do relatório (visível também na impressão) */}
          <div className="bg-gradient-to-br from-ink to-ink/90 text-stone-100 rounded-sm p-6 mb-6">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-gold mb-2">
                  <Building2 className="w-4 h-4" /> {data.company.name}
                </div>
                <h2 className="font-display text-2xl mb-1">DRE — {data.period.label}</h2>
                <p className="text-sm text-stone-300">Comparativo com {data.period.previous_label}</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Lucro Líquido</div>
                <div className={`font-display text-3xl ${Number(data.indicators.lucro_liquido) >= 0 ? 'text-gold' : 'text-red-300'}`}>
                  {formatBRL(data.indicators.lucro_liquido)}
                </div>
                {data.indicators.variacao_lucro !== null && (
                  <div className="text-xs mt-1 flex items-center justify-end gap-1">
                    {data.indicators.variacao_lucro > 0 ? <TrendingUp className="w-3 h-3 text-green-300" /> : <TrendingDown className="w-3 h-3 text-red-300" />}
                    <span className={data.indicators.variacao_lucro > 0 ? 'text-green-300' : 'text-red-300'}>
                      {formatPercent(data.indicators.variacao_lucro)} vs período anterior
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4 Cards Principais */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-amber-700" />
                <span className="text-xs uppercase tracking-wider text-stone-500">Receita Bruta</span>
              </div>
              <div className="font-display text-2xl text-amber-800">{formatBRL(data.indicators.receita_bruta)}</div>
              <VariationBadge value={data.indicators.variacao_receita} />
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-green-700" />
                <span className="text-xs uppercase tracking-wider text-stone-500">Lucro Bruto</span>
              </div>
              <div className="font-display text-2xl text-green-800">{formatBRL(data.indicators.lucro_bruto)}</div>
              {data.indicators.margem_bruta !== null && (
                <div className="text-xs text-stone-500 mt-1">Margem: <strong>{data.indicators.margem_bruta.toFixed(1)}%</strong></div>
              )}
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200 rounded-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-amber-700" />
                <span className="text-xs uppercase tracking-wider text-amber-800">Lucro Líquido</span>
              </div>
              <div className={`font-display text-2xl ${Number(data.indicators.lucro_liquido) >= 0 ? 'text-amber-900' : 'text-red-700'}`}>
                {formatBRL(data.indicators.lucro_liquido)}
              </div>
              {data.indicators.margem_liquida !== null && (
                <div className="text-xs text-amber-800 mt-1">Margem: <strong>{data.indicators.margem_liquida.toFixed(1)}%</strong></div>
              )}
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-purple-700" />
                <span className="text-xs uppercase tracking-wider text-stone-500">Payout (RTP)</span>
              </div>
              <div className="font-display text-2xl text-purple-800">
                {data.indicators.payout_ratio !== null ? `${data.indicators.payout_ratio.toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs text-stone-500 mt-1">Prêmios ÷ Apostas</div>
            </div>
          </div>

          {/* Tabela DRE estruturada */}
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-stone-200">
              <h2 className="font-display text-xl">DRE Estruturada</h2>
              <p className="text-xs text-stone-500 mt-1">Comparativo entre {data.period.label} e {data.period.previous_label}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">{data.period.label}</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-500">{data.period.previous_label}</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600 w-24">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line, i) => <DreLineRow key={i} line={line} />)}
                </tbody>
              </table>
            </div>
          </div>

          {/* Composição de despesas + Indicadores */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6 print:break-inside-avoid">
            <div className="bg-white border border-stone-200 rounded-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <PieChart className="w-5 h-5 text-stone-400" />
                <h2 className="font-display text-xl">Composição das Despesas</h2>
              </div>
              <ExpensesPieChart items={data.expenses_by_category} />
            </div>

            <div className="bg-white border border-stone-200 rounded-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-stone-400" />
                <h2 className="font-display text-xl">Indicadores</h2>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-stone-200">
                  <span className="text-sm text-stone-600">Margem Bruta</span>
                  <span className="font-mono font-medium">{data.indicators.margem_bruta?.toFixed(1) ?? '—'}%</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-stone-200">
                  <span className="text-sm text-stone-600">Margem Operacional (EBT)</span>
                  <span className="font-mono font-medium">{data.indicators.margem_operacional?.toFixed(1) ?? '—'}%</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-stone-200">
                  <span className="text-sm font-medium text-stone-900">Margem Líquida</span>
                  <span className="font-mono font-medium text-amber-800">{data.indicators.margem_liquida?.toFixed(1) ?? '—'}%</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-stone-200">
                  <span className="text-sm text-stone-600">EBITDA</span>
                  <span className="font-mono">{formatBRL(data.indicators.ebitda)}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-stone-200">
                  <span className="text-sm text-stone-600">EBT (Lucro antes IRPJ/CSLL)</span>
                  <span className="font-mono">{formatBRL(data.indicators.ebt)}</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-sm text-stone-600">Payout Ratio (RTP)</span>
                  <span className="font-mono">{data.indicators.payout_ratio?.toFixed(1) ?? '—'}%</span>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 mt-3 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-700 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-800">
                    <strong>Margem Líquida</strong> indica o lucro final como % da receita líquida. <strong>Payout</strong> mostra o % das apostas que volta para os jogadores como prêmios.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Gráfico mensal */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6 print:break-before-page">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-stone-400" />
              <h2 className="font-display text-xl">Evolução dos últimos 12 meses</h2>
            </div>
            <MonthlyChart data={data.monthly_series} />
          </div>

          {/* Footer impressão */}
          <div className="hidden print:block text-xs text-stone-500 mt-6 pt-3 border-t border-stone-200">
            Relatório gerado em {new Date().toLocaleString('pt-BR')} · ContBet · {data.company.name}
          </div>
        </>
      )}
    </div>
  );
}
