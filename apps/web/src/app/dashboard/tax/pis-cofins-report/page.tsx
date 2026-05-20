'use client';

import { useEffect, useState } from 'react';
import { Calculator, Download, FileBarChart2, Printer, FileText, Building2, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import { PageHeader, Field, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

interface Brand { id: string; name: string; company_id: string }

interface BrandBreakdown {
  brand_id: string;
  brand: { id: string; name: string };
  ggr: string;
  ratio: number;
  revenue: string;
  pis_amount: string;
  cofins_amount: string;
  total: string;
  has_data: boolean;
}

interface PisCofinsReportData {
  company: { id: string; name: string; cnpj: string; city: string; state: string; tax_regime: string };
  tax_config: { pis_rate: string; cofins_rate: string; pis_cofins_regime: string } | null;
  year: number;
  month: number;
  brand_filter: string | null;
  apuration: {
    id: string; status: string; regime: string;
    ggr_revenue: string; other_revenue: string; total_revenue: string; expenses_with_credit: string;
    pis_rate: string; pis_amount: string; pis_credits: string; pis_amount_payable: string;
    cofins_rate: string; cofins_amount: string; cofins_credits: string; cofins_amount_payable: string;
  } | null;
  brands_breakdown: BrandBreakdown[];
  totals: {
    brands_count: number; brands_with_data: number;
    ggr_total: string; total_revenue: string;
    pis_amount: string; pis_credits: string; pis_amount_payable: string;
    cofins_amount: string; cofins_credits: string; cofins_amount_payable: string;
    total_payable: string;
    pis_rate: string; cofins_rate: string;
    regime: string;
  };
  generated_at: string;
}

export default function PisCofinsReportPage() {
  const { user } = useAuth();
  const today = new Date();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allBrands, setAllBrands] = useState<Brand[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [report, setReport] = useState<PisCofinsReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    });
    api.get('/brands').then(r => setAllBrands(r.data.data));
  }, [user]);

  const visibleBrands = companyId ? allBrands.filter(b => b.company_id === companyId) : [];

  const reload = async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params: any = {};
      if (brandId) params.brand_id = brandId;
      const res = await api.get(`/tax/pis-cofins/report/${companyId}/${year}/${month}`, { params });
      setReport(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao carregar relatório.');
      setReport(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId, brandId, year, month]);

  const exportFile = async (kind: 'xlsx' | 'pdf') => {
    if (!companyId) return;
    if (kind === 'xlsx') setExporting(true); else setExportingPdf(true);
    try {
      const path = kind === 'pdf' ? 'export-pdf' : 'export';
      const params: any = {};
      if (brandId) params.brand_id = brandId;
      const res = await api.get(`/tax/pis-cofins/report/${companyId}/${year}/${month}/${path}`, { params, responseType: 'blob' });
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      const mime = kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const blob = new Blob([res.data], { type: mime });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const brandSuffix = brandId ? `-${visibleBrands.find(b => b.id === brandId)?.name?.replace(/[^a-zA-Z0-9]/g, '_') ?? ''}` : '';
      a.href = url; a.download = `apuracao-pis-cofins${brandSuffix}-${month.toString().padStart(2, '0')}-${year}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao exportar.');
    } finally {
      if (kind === 'xlsx') setExporting(false); else setExportingPdf(false);
    }
  };

  const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER' && user?.profile !== 'OWNER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const regimeLabel = report?.totals.regime === 'NAO_CUMULATIVO'
    ? `Não Cumulativo (${report.totals.pis_rate}% + ${report.totals.cofins_rate}%)`
    : `Cumulativo (${report?.totals.pis_rate ?? '0,65'}% + ${report?.totals.cofins_rate ?? '3,00'}%)`;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Relatório de Apuração PIS/COFINS"
        subtitle="Tributos federais sobre receita — apuração mensal"
        action={
          <div className="flex gap-2 print:hidden">
            <button onClick={() => window.print()} disabled={!report}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-stone-100 text-ink text-sm rounded-sm hover:bg-stone-200 transition disabled:opacity-50">
              <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button onClick={() => exportFile('pdf')} disabled={!report || exportingPdf}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-700 text-white text-sm rounded-sm hover:bg-red-800 transition disabled:opacity-50">
              <FileText className="w-4 h-4" /> {exportingPdf ? 'Gerando…' : 'Exportar PDF'}
            </button>
            <button onClick={() => exportFile('xlsx')} disabled={!report || exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition disabled:opacity-50">
              <Download className="w-4 h-4" /> {exporting ? 'Exportando…' : 'Exportar Excel'}
            </button>
          </div>
        }
      />

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 grid sm:grid-cols-4 gap-3 print:hidden">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => { setCompanyId(e.target.value); setBrandId(''); }} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Marca (opcional)">
          <Select value={brandId} onChange={e => setBrandId(e.target.value)}>
            <option value="">Todas as marcas</option>
            {visibleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Mês">
          <Select value={String(month)} onChange={e => setMonth(parseInt(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
              <option key={m} value={m}>{String(m).padStart(2, '0')} - {monthNames[m - 1]}</option>)}
          </Select>
        </Field>
        <Field label="Ano">
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm" />
        </Field>
      </div>

      {loading && <div className="text-center text-stone-500 py-8">Carregando…</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-sm p-4 text-red-800 mb-6">{error}</div>}

      {report && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="bg-stone-900 text-stone-100 p-6 print:bg-white print:text-stone-900 print:border-b print:border-stone-300">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-widest text-stone-400 print:text-stone-500 mb-1">
                  Apuração PIS / COFINS — Receita Federal
                </div>
                <h2 className="font-display text-3xl">{monthNames[month - 1]} / {year}</h2>
              </div>
              <div className="text-right">
                <div className="font-medium text-lg">{report.company.name}</div>
                <div className="text-sm text-stone-300 print:text-stone-600 font-mono">CNPJ {fmtCnpj(report.company.cnpj || '')}</div>
                <div className="text-xs text-stone-400 print:text-stone-600">{[report.company.city, report.company.state].filter(Boolean).join('/')}</div>
                {report.brand_filter && report.brands_breakdown[0] && (
                  <div className="mt-2 inline-block px-2 py-1 text-xs uppercase tracking-wider bg-amber-700 text-white rounded-sm">
                    Marca: {report.brands_breakdown[0].brand.name}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-blue-700 text-white">
                <Scale className="w-3 h-3" /> {regimeLabel}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-stone-700 text-stone-100">
                PIS: {report.totals.pis_rate}%
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-stone-700 text-stone-100">
                COFINS: {report.totals.cofins_rate}%
              </span>
            </div>
          </div>

          {/* Cards principais */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-6 border-b border-stone-200">
            <SummaryCard label="GGR (base)" value={report.totals.ggr_total} subtitle={`${report.totals.brands_with_data} marca(s)`} highlight="amber" />
            <SummaryCard label="PIS a recolher" value={report.totals.pis_amount_payable} subtitle={`${report.totals.pis_rate}%`} highlight="red" />
            <SummaryCard label="COFINS a recolher" value={report.totals.cofins_amount_payable} subtitle={`${report.totals.cofins_rate}%`} highlight="red" />
            <SummaryCard label="Total PIS+COFINS" value={report.totals.total_payable} subtitle="A recolher em DARF" highlight="red" />
          </div>

          {/* Composição da apuração */}
          {report.apuration && (
            <div className="p-6 border-b border-stone-200">
              <h3 className="font-display text-xl mb-4">Composição da apuração</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <ComputeRow label="GGR (com metodologia)" value={report.apuration.ggr_revenue} />
                <ComputeRow label="Outras receitas operacionais" value={report.apuration.other_revenue} />
                <ComputeRow label="Receita total (base)" value={report.apuration.total_revenue} highlight />
                <ComputeRow label="Despesas com crédito" value={report.apuration.expenses_with_credit} />
                <ComputeRow label={`PIS bruto (${report.totals.pis_rate}%)`} value={report.apuration.pis_amount} />
                <ComputeRow label="(−) Créditos PIS" value={report.apuration.pis_credits} />
                <ComputeRow label={`COFINS bruto (${report.totals.cofins_rate}%)`} value={report.apuration.cofins_amount} />
                <ComputeRow label="(−) Créditos COFINS" value={report.apuration.cofins_credits} />
              </div>
            </div>
          )}

          {/* Rateio por marca */}
          <div className="p-6 border-b border-stone-200">
            <h3 className="font-display text-xl mb-2">{report.brand_filter ? 'Marca filtrada' : 'Rateio por marca'}</h3>
            <p className="text-xs text-stone-500 mb-4">
              ⚠ PIS e COFINS são federais e devidos pelo CNPJ (não por marca). O rateio abaixo é proporcional ao GGR positivo de cada marca, útil para gestão interna.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Marca</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">% do GGR</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-amber-700">GGR</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-red-700">PIS</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-red-700">COFINS</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-red-800">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.brands_breakdown.map(b => (
                    <tr key={b.brand_id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-3 py-2 font-medium">{b.brand?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-stone-600">
                        {b.has_data ? `${(b.ratio * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-amber-800">{formatBRL(b.ggr)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatBRL(b.pis_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatBRL(b.cofins_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-red-800">{formatBRL(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
                {!report.brand_filter && (
                  <tfoot className="bg-stone-100 border-t-2 border-stone-300">
                    <tr>
                      <td className="px-3 py-2 font-bold uppercase text-xs">Total</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">100,00%</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-amber-900">{formatBRL(report.totals.ggr_total)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(report.totals.pis_amount_payable)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(report.totals.cofins_amount_payable)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-red-900">{formatBRL(report.totals.total_payable)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="p-6 text-xs text-stone-500 flex items-center justify-between flex-wrap gap-2">
            <div>
              <FileBarChart2 className="w-3.5 h-3.5 inline mr-1" />
              Relatório gerado em {new Date(report.generated_at).toLocaleString('pt-BR')}
            </div>
            <div>PIS/COFINS são federais — recolhidos em DARF</div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, subtitle, highlight }: { label: string; value: string; subtitle?: string; highlight?: 'amber' | 'red' | 'green' }) {
  const color = highlight === 'amber' ? 'text-amber-900'
    : highlight === 'red' ? 'text-red-900'
    : highlight === 'green' ? 'text-green-900'
    : 'text-ink';
  return (
    <div className="bg-stone-50 border border-stone-200 rounded-sm p-4">
      <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">{label}</div>
      <div className={`font-display text-2xl ${color}`}>{formatBRL(value)}</div>
      {subtitle && <div className="text-xs text-stone-500 mt-1">{subtitle}</div>}
    </div>
  );
}

function ComputeRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-sm ${highlight ? 'bg-amber-50 border border-amber-200' : 'bg-stone-50 border border-stone-200'}`}>
      <span className="text-sm text-stone-700">{label}</span>
      <span className={`font-mono font-medium ${highlight ? 'text-amber-900' : 'text-stone-900'}`}>{formatBRL(value)}</span>
    </div>
  );
}
