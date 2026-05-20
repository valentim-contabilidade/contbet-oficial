'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calculator, Download, Building2, FileBarChart2, AlertTriangle, CheckCircle2, Eye, Printer, FileText, MapPin, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import { PageHeader, Field, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

interface BrandBreakdown {
  brand_id: string;
  brand: { id: string; name: string };
  ggr: string;
  ratio: number;
  base_amount: string;
  iss_amount: string;
  has_data: boolean;
}

interface IssReportData {
  company: { id: string; name: string; cnpj: string; city: string; state: string; tax_regime: string };
  tax_config: { iss_rate: string; iss_calculation_base: string; ggr_methodology: string } | null;
  year: number;
  month: number;
  iss_apuration: {
    id: string;
    status: string;
    calculation_base: string;
    iss_rate: string;
    ggr_amount: string;
    bet_tax_amount: string;
    base_amount: string;
    iss_amount: string;
  } | null;
  brands_breakdown: BrandBreakdown[];
  totals: {
    brands_count: number;
    brands_with_data: number;
    ggr_total: string;
    base_amount: string;
    iss_amount: string;
    iss_rate: string | number;
    calculation_base: string;
  };
  generated_at: string;
}

interface Brand { id: string; name: string; company_id: string }

export default function IssReportPage() {
  const { user } = useAuth();
  const today = new Date();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allBrands, setAllBrands] = useState<Brand[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [report, setReport] = useState<IssReportData | null>(null);
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
    api.get('/brands').then(r => setAllBrands(r.data.data ?? []));
  }, [user]);

  const visibleBrands = companyId ? allBrands.filter(b => b.company_id === companyId) : [];

  const reload = async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try {
      const params: any = brandId ? { brand_id: brandId } : {};
      const res = await api.get(`/tax/iss/report/${companyId}/${year}/${month}`, { params });
      setReport(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao carregar relatório.');
      setReport(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId, brandId, year, month]);

  const exportXlsx = async () => {
    if (!companyId) return;
    setExporting(true);
    try {
      const params: any = brandId ? { brand_id: brandId } : {};
      const res = await api.get(`/tax/iss/report/${companyId}/${year}/${month}/export`, { params, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `apuracao-iss-${month.toString().padStart(2, '0')}-${year}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao exportar.');
    } finally { setExporting(false); }
  };

  const exportPdf = async () => {
    if (!companyId) return;
    setExportingPdf(true);
    try {
      const params: any = brandId ? { brand_id: brandId } : {};
      const res = await api.get(`/tax/iss/report/${companyId}/${year}/${month}/export-pdf`, { params, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `apuracao-iss-${month.toString().padStart(2, '0')}-${year}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao exportar PDF.');
    } finally { setExportingPdf(false); }
  };

  const print = () => window.print();
  const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const baseLabel = report?.totals.calculation_base === 'NGR'
    ? 'NGR (GGR − Lei 14.790)'
    : 'GGR (Apostas − Prêmios)';

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Relatório de Apuração ISS"
        subtitle="Imposto Sobre Serviços — apuração mensal por município (LC 116/2003 art. 8-A)"
        action={
          <div className="flex gap-2 print:hidden">
            <button onClick={print} disabled={!report}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-stone-100 text-ink text-sm rounded-sm hover:bg-stone-200 transition disabled:opacity-50">
              <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button onClick={exportPdf} disabled={!report || exportingPdf}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-700 text-white text-sm rounded-sm hover:bg-red-800 transition disabled:opacity-50">
              <FileText className="w-4 h-4" /> {exportingPdf ? 'Gerando…' : 'Exportar PDF'}
            </button>
            <button onClick={exportXlsx} disabled={!report || exporting}
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
          {/* Cabeçalho */}
          <div className="bg-stone-900 text-stone-100 p-6 print:bg-white print:text-stone-900 print:border-b print:border-stone-300">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-widest text-stone-400 print:text-stone-500 mb-1">
                  Apuração ISS — Imposto Sobre Serviços
                </div>
                <h2 className="font-display text-3xl">{monthNames[month - 1]} / {year}</h2>
              </div>
              <div className="text-right">
                <div className="font-medium text-lg">{report.company.name}</div>
                <div className="text-sm text-stone-300 print:text-stone-600 font-mono">CNPJ {fmtCnpj(report.company.cnpj || '')}</div>
                <div className="text-xs text-stone-400 print:text-stone-600">{[report.company.city, report.company.state].filter(Boolean).join('/')}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-blue-700 text-white">
                <MapPin className="w-3 h-3" /> Município sede: {[report.company.city, report.company.state].filter(Boolean).join('/') || '—'}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-stone-700 text-stone-100 print:bg-stone-100 print:text-stone-800 print:border print:border-stone-300">
                <Scale className="w-3 h-3" /> Base: {baseLabel}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-red-700 text-white">
                <Calculator className="w-3 h-3" /> Alíquota: {report.totals.iss_rate}%
              </span>
            </div>
          </div>

          {/* 3 cards principais */}
          <div className="grid sm:grid-cols-3 gap-3 p-6 border-b border-stone-200">
            <SummaryCard label="GGR do mês" value={report.totals.ggr_total} subtitle={`${report.totals.brands_with_data} marcas com dados`} highlight="amber" />
            <SummaryCard label="Base de cálculo" value={report.totals.base_amount} subtitle={baseLabel} />
            <SummaryCard label="ISS a recolher" value={report.totals.iss_amount} subtitle={`${report.totals.iss_rate}% sobre a base`} highlight="red" />
          </div>

          {/* Tabela detalhada */}
          <div className="p-6 border-b border-stone-200">
            <h3 className="font-display text-xl mb-2">Rateio por marca</h3>
            <p className="text-xs text-stone-500 mb-4">
              ⚠ ISS é devido pelo CNPJ ao município da sede (não por marca). O rateio abaixo é proporcional ao GGR de cada marca, útil para gestão interna.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Marca</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-amber-700">GGR</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">% do total</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Base ISS</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-red-700">ISS devido</th>
                  </tr>
                </thead>
                <tbody>
                  {report.brands_breakdown.map(b => (
                    <tr key={b.brand_id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-3 py-2 font-medium">{b.brand?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-amber-800">{formatBRL(b.ggr)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-stone-600">
                        {b.has_data ? `${(b.ratio * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatBRL(b.base_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-red-800">{formatBRL(b.iss_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-100 border-t-2 border-stone-300">
                  <tr>
                    <td className="px-3 py-2 font-bold uppercase text-xs tracking-wider">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-900">{formatBRL(report.totals.ggr_total)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">100,00%</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(report.totals.base_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-red-900">{formatBRL(report.totals.iss_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Base legal */}
          <div className="p-6 border-b border-stone-200 bg-blue-50/30">
            <h3 className="font-display text-xl mb-2">Base legal</h3>
            <ul className="text-sm text-stone-700 space-y-1 list-disc ml-5">
              <li><strong>Lei Complementar 116/2003, art. 8-A</strong> — alíquotas municipais variam de 2% a 5%.</li>
              <li>ISS é devido ao município da sede do prestador (regra geral).</li>
              <li>Algumas legislações municipais autorizam GGR como base; outras só aceitam NGR (GGR − Lei 14.790). Confirme com a prefeitura.</li>
              <li>Município sede da empresa: <strong>{[report.company.city, report.company.state].filter(Boolean).join('/') || '—'}</strong> · alíquota efetiva: <strong>{report.totals.iss_rate}%</strong>.</li>
              <li>Marcas com GGR ≤ 0 (prejuízo) não geram ISS no mês.</li>
            </ul>
          </div>

          {/* Footer */}
          <div className="p-6 text-xs text-stone-500 flex items-center justify-between flex-wrap gap-2">
            <div>
              <FileBarChart2 className="w-3.5 h-3.5 inline mr-1" />
              Relatório gerado em {new Date(report.generated_at).toLocaleString('pt-BR')}
            </div>
            {report.iss_apuration && (
              <div>
                Apuração ISS · Status: <strong>{report.iss_apuration.status === 'CLOSED' ? 'Fechada' : report.iss_apuration.status === 'PAID' ? 'Paga' : 'Aberta'}</strong>
              </div>
            )}
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
