'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calculator, Download, Building2, Calendar, FileBarChart2, AlertTriangle, CheckCircle2, Eye, Printer, FileText, Landmark } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import { PageHeader, Field, Select } from '@/components/ui';
import type { Company } from '@/lib/types';

const methodLabels: Record<string, { label: string; color: string }> = {
  OFFICIAL: { label: 'Oficial SPA/MF', color: 'bg-green-50 text-green-800 border-green-200' },
  DEDUCT_CASHBACK: { label: 'Abatendo Cashback', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  DEDUCT_BONUS_CASHBACK: { label: 'Abatendo Bônus e Cashback', color: 'bg-red-50 text-red-800 border-red-200' },
};

interface ApurationRow {
  brand_id: string;
  brand: { id: string; name: string };
  year: number;
  month: number;
  status?: string;
  total_bets?: string;
  total_prizes?: string;
  total_deposits?: string;
  total_withdrawals?: string;
  total_bonus?: string;
  total_cashback?: string;
  ggr?: string;
  net_revenue?: string;
  ggr_methodology?: string;
  tax_lei14790_amount?: string;
  pis_amount?: string;
  cofins_amount?: string;
  irrf_amount?: string;
  total_taxes?: string;
  _error?: string | null;
}

type DestinationCategory =
  | 'CONTA_UNICA_TESOURO' | 'ENTIDADE_PRIVADA' | 'EDUCACAO' | 'IMAGEM_PROP_INTELECTUAL';

interface DestinationDef {
  slug: string; name: string; dispositivo: string; category: DestinationCategory;
  percent_of_destinations: number; darf_code?: '9197' | '6524' | '5862';
  payment_method: string; per_competition?: boolean;
}
interface BeneficiaryAmount {
  destination: DestinationDef;
  effective_rate_on_ggr: number;
  valor_centavos: string;
}
interface CategoryBreakdown {
  category: DestinationCategory;
  beneficiaries: BeneficiaryAmount[];
  total_centavos: string;
}
interface DarfCodeBreakdown {
  codigo: '9197' | '6524' | '5862';
  descricao: string;
  beneficiaries: BeneficiaryAmount[];
  total_centavos: string;
  includes_funapol_caput?: boolean;
}
interface FunapolCaputBreakdown {
  ref_year: number; ref_month: number; rate_on_ggr: number; valor_centavos: string;
}
interface DestinationsBreakdown {
  ggr_centavos: string;
  base_destinacoes_centavos: string;
  categories: CategoryBreakdown[];
  darf_codes: DarfCodeBreakdown[];
  total_destinacoes_12pct_centavos: string;
  funapol_caput: FunapolCaputBreakdown | null;
  total_recolhimento_centavos: string;
  effective_total_rate_pct: number;
}

// (legado, mantido p/ seção DARF compacta)
interface DarfBeneficiaryAmount {
  beneficiario: { name: string; dispositivo: string; percentual_no_codigo: number; slug: string };
  valor_centavos: string;
}
interface DarfCodeAmount {
  codigo: string;
  descricao: string;
  tipo: 'contribuicao' | 'participacao_patrimonial';
  percentual_do_ggr: number;
  valor_total_centavos: string;
  beneficiarios: DarfBeneficiaryAmount[];
}
interface DarfBreakdown {
  ggr_centavos: string;
  total_recolhimento_centavos: string;
  codigos: DarfCodeAmount[];
}

interface ReportData {
  company: { id: string; name: string; cnpj: string; city: string; state: string; tax_regime: string };
  tax_config: {
    tax_regime: string;
    ggr_methodology: string;
    ggr_term_signed_at?: string | null;
    ggr_term_signed_by_name?: string | null;
  } | null;
  year: number;
  month: number;
  brands_apurations: ApurationRow[];
  totals: {
    brands_count: number;
    brands_with_data: number;
    brands_with_error: number;
    total_bets: string;
    total_prizes: string;
    total_deposits: string;
    total_withdrawals: string;
    total_bonus: string;
    total_cashback: string;
    ggr: string;
    net_revenue: string;
    tax_lei14790_amount: string;
    pis_amount: string;
    cofins_amount: string;
    irrf_amount: string;
    total_taxes: string;
  };
  darf_breakdown?: DarfBreakdown;
  destinations_breakdown?: DestinationsBreakdown;
  destinations_metadata?: {
    category_labels: Record<DestinationCategory, string>;
    category_descriptions: Record<DestinationCategory, string>;
  };
  generated_at: string;
}

interface Brand { id: string; name: string; company_id: string }

export default function ApurationReportPage() {
  const { user } = useAuth();
  const today = new Date();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allBrands, setAllBrands] = useState<Brand[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [report, setReport] = useState<ReportData | null>(null);
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
      const params: any = {};
      if (brandId) params.brand_id = brandId;
      const res = await api.get(`/ggr/report/${companyId}/${year}/${month}`, { params });
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
      const res = await api.get(`/ggr/report/${companyId}/${year}/${month}/export`, { params, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `apuracao-ggr-${month.toString().padStart(2, '0')}-${year}.xlsx`;
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
      const res = await api.get(`/ggr/report/${companyId}/${year}/${month}/export-pdf`, { params, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `apuracao-ggr-${month.toString().padStart(2, '0')}-${year}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao exportar PDF.');
    } finally { setExportingPdf(false); }
  };

  const print = () => window.print();

  const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER' && user?.profile !== 'OWNER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Relatório de Apuração GGR"
        subtitle="Resumo mensal consolidado por empresa — todas as marcas em uma visão"
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
          {/* Cabeçalho do relatório */}
          <div className="bg-stone-900 text-stone-100 p-6 print:bg-white print:text-stone-900 print:border-b print:border-stone-300">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-widest text-stone-400 print:text-stone-500 mb-1">
                  Apuração GGR — Lei 14.790/2023
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
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-stone-700 text-stone-100 print:bg-stone-100 print:text-stone-800 print:border print:border-stone-300">
                <Building2 className="w-3 h-3" /> Regime: {report.company.tax_regime ?? '—'}
              </span>
              {report.tax_config && (
                <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm border ${methodLabels[report.tax_config.ggr_methodology]?.color ?? 'bg-stone-100 text-stone-800 border-stone-300'}`}>
                  <Calculator className="w-3 h-3" /> {methodLabels[report.tax_config.ggr_methodology]?.label ?? report.tax_config.ggr_methodology}
                </span>
              )}
              {report.tax_config?.ggr_term_signed_at && (
                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wider rounded-sm bg-green-50 text-green-800 border border-green-200">
                  <CheckCircle2 className="w-3 h-3" /> Termo assinado
                </span>
              )}
            </div>
          </div>

          {/* Cards de totais */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-6 border-b border-stone-200">
            <SummaryCard label="GGR consolidado" value={report.totals.ggr} subtitle={`${report.totals.brands_with_data} marcas com dados`} highlight="amber" />
            <SummaryCard label="Imposto Lei 14.790" value={report.totals.tax_lei14790_amount} subtitle="13% sobre o GGR" highlight="red" />
            <SummaryCard label="Apostas brutas" value={report.totals.total_bets} subtitle="Volume total recebido" />
            <SummaryCard label="Prêmios pagos" value={report.totals.total_prizes} subtitle="Pagamentos a apostadores" />
          </div>

          {/* GGR por marca — cards individuais */}
          <div className="p-6 border-b border-stone-200">
            <h3 className="font-display text-xl mb-4">GGR por marca</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.brands_apurations.map(a => (
                <BrandGgrCard key={a.brand_id} apuration={a} />
              ))}
            </div>
          </div>

          {/* Detalhamento tributário do GGR */}
          <div className="p-6 border-b border-stone-200">
            <h3 className="font-display text-xl mb-2">Tributos do GGR (Lei 14.790)</h3>
            <p className="text-xs text-stone-500 mb-4">
              ⚠ PIS e COFINS são apurados separadamente em "Apurações Tributárias" (não compõem o total do GGR).
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <TaxRow label="Imposto Lei 14.790 (13% s/ GGR)" value={report.totals.tax_lei14790_amount} highlight />
              <TaxRow label="IRRF (sobre prêmios)" value={report.totals.irrf_amount} />
            </div>
          </div>

          {/* Destinações da Lei 14.790 — Manual SPA/MF 08/05/2026 */}
          {report.destinations_breakdown && Number(report.destinations_breakdown.total_recolhimento_centavos) > 0 && (
            <DestinationsSection
              breakdown={report.destinations_breakdown}
              labels={report.destinations_metadata?.category_labels}
              descriptions={report.destinations_metadata?.category_descriptions}
            />
          )}


          {/* Tabela detalhada por marca */}
          <div className="p-6 border-b border-stone-200">
            <h3 className="font-display text-xl mb-4">Detalhamento por marca</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Marca</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Apostas</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Prêmios</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-amber-700">GGR</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Bônus</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-stone-600">Cashback</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-red-700">Lei 14.790</th>
                    <th className="text-right px-3 py-2 text-xs uppercase tracking-wider text-red-800" title="Lei 14.790 + IRRF">Imp. GGR</th>
                    <th className="text-center px-3 py-2 text-xs uppercase tracking-wider text-stone-600 print:hidden">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {report.brands_apurations.map(a => (
                    <tr key={a.brand_id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-3 py-2 font-medium">{a.brand?.name ?? '—'}</td>
                      {a._error ? (
                        <td colSpan={7} className="px-3 py-2 text-xs text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> {a._error}
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatBRL(a.total_bets)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{formatBRL(a.total_prizes)}</td>
                          <td className={`px-3 py-2 text-right font-mono font-medium ${Number(a.ggr) >= 0 ? 'text-amber-800' : 'text-red-700'}`}>
                            {formatBRL(a.ggr)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-stone-600">{formatBRL(a.total_bonus)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-stone-600">{formatBRL(a.total_cashback)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-red-700">{formatBRL(a.tax_lei14790_amount)}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-red-800">{formatBRL(a.total_taxes)}</td>
                        </>
                      )}
                      <td className="px-3 py-2 text-center print:hidden">
                        {!a._error && (
                          <Link href={`/dashboard/ggr/monthly/${a.brand_id}/${a.year}/${a.month}`}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-ink bg-stone-100 hover:bg-stone-200 rounded-sm">
                            <Eye className="w-3 h-3" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-100 border-t-2 border-stone-300">
                  <tr>
                    <td className="px-3 py-2 font-bold uppercase text-xs tracking-wider">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(report.totals.total_bets)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(report.totals.total_prizes)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-900">{formatBRL(report.totals.ggr)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-stone-700">{formatBRL(report.totals.total_bonus)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-stone-700">{formatBRL(report.totals.total_cashback)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-red-800">{formatBRL(report.totals.tax_lei14790_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-red-900">{formatBRL(report.totals.total_taxes)}</td>
                    <td className="print:hidden"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Movimentação de jogadores */}
          <div className="p-6 border-b border-stone-200">
            <h3 className="font-display text-xl mb-4">Movimentação de jogadores</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <SummaryCard label="Depósitos" value={report.totals.total_deposits} highlight="green" />
              <SummaryCard label="Saques" value={report.totals.total_withdrawals} highlight="red" />
              <SummaryCard label="Saldo retido (jogadores)"
                value={(BigInt(report.totals.total_deposits) - BigInt(report.totals.total_withdrawals)).toString()} />
            </div>
          </div>

          {/* Footer com info de geração */}
          <div className="p-6 text-xs text-stone-500 flex items-center justify-between flex-wrap gap-2">
            <div>
              <FileBarChart2 className="w-3.5 h-3.5 inline mr-1" />
              Relatório gerado em {new Date(report.generated_at).toLocaleString('pt-BR')}
            </div>
            {report.tax_config?.ggr_term_signed_at && (
              <div>
                Termo de responsabilidade assinado por <strong>{report.tax_config.ggr_term_signed_by_name}</strong>
                {' '}em {new Date(report.tax_config.ggr_term_signed_at).toLocaleDateString('pt-BR')}
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

function TaxRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-sm ${highlight ? 'bg-red-50 border border-red-200' : 'bg-stone-50 border border-stone-200'}`}>
      <span className="text-sm text-stone-700">{label}</span>
      <span className={`font-mono font-medium ${highlight ? 'text-red-900' : 'text-stone-900'}`}>{formatBRL(value)}</span>
    </div>
  );
}

/**
 * Card individual por marca: GGR em destaque + base de cálculo (apostas/prêmios)
 * + imposto Lei 14.790 da marca. Destaca prejuízos em vermelho.
 */
function BrandGgrCard({ apuration }: { apuration: ApurationRow }) {
  if (apuration._error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-sm p-4">
        <div className="font-medium text-sm mb-1">{apuration.brand?.name ?? '—'}</div>
        <div className="flex items-start gap-1.5 text-xs text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {apuration._error}
        </div>
      </div>
    );
  }
  const ggr = Number(apuration.ggr ?? 0);
  const isNegative = ggr < 0;
  return (
    <div className={`border rounded-sm p-4 ${isNegative ? 'bg-red-50/30 border-red-200' : 'bg-amber-50/30 border-amber-200'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-medium text-sm">{apuration.brand?.name ?? '—'}</div>
        <Link href={`/dashboard/ggr/monthly/${apuration.brand_id}/${apuration.year}/${apuration.month}`}
          className="text-xs text-stone-500 hover:text-ink inline-flex items-center gap-1 print:hidden">
          <Eye className="w-3 h-3" /> ver
        </Link>
      </div>
      <div className="text-xs text-stone-500 uppercase tracking-wider mb-1">GGR</div>
      <div className={`font-display text-2xl ${isNegative ? 'text-red-700' : 'text-amber-900'} mb-2`}>
        {formatBRL(apuration.ggr ?? 0)}
      </div>
      <div className="space-y-1 text-xs text-stone-600">
        <div className="flex justify-between">
          <span>Apostas</span>
          <span className="font-mono">{formatBRL(apuration.total_bets ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span>Prêmios</span>
          <span className="font-mono">−{formatBRL(apuration.total_prizes ?? 0)}</span>
        </div>
        <div className="flex justify-between pt-1 mt-1 border-t border-stone-200">
          <span className="text-red-700">Imp. Lei 14.790 (13%)</span>
          <span className="font-mono font-medium text-red-800">{formatBRL(apuration.tax_lei14790_amount ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}

const CATEGORY_BADGE: Record<DestinationCategory, { label: string; color: string }> = {
  CONTA_UNICA_TESOURO: { label: 'DARF', color: 'bg-blue-50 text-blue-800 border-blue-200' },
  ENTIDADE_PRIVADA:    { label: 'Transferência', color: 'bg-violet-50 text-violet-800 border-violet-200' },
  EDUCACAO:            { label: 'MEC', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  IMAGEM_PROP_INTELECTUAL: { label: 'Por competição', color: 'bg-amber-50 text-amber-800 border-amber-200' },
};

function DestinationsSection({
  breakdown,
  labels,
  descriptions,
}: {
  breakdown: DestinationsBreakdown;
  labels?: Record<DestinationCategory, string>;
  descriptions?: Record<DestinationCategory, string>;
}) {
  const fmtPct = (n: number) =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

  // ordem de exibição das categorias
  const categoriesInOrder: DestinationCategory[] = [
    'CONTA_UNICA_TESOURO', 'ENTIDADE_PRIVADA', 'EDUCACAO', 'IMAGEM_PROP_INTELECTUAL',
  ];
  const cats = categoriesInOrder
    .map(c => breakdown.categories.find(x => x.category === c))
    .filter((x): x is CategoryBreakdown => !!x);

  return (
    <div className="p-6 border-b border-stone-200 print:break-before-page">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h3 className="font-display text-xl">Destinações da Lei 14.790 — repasses diretos</h3>
          <p className="text-xs text-stone-500 mt-1">
            Manual SPA/MF (08/05/2026) · Lei 13.756/2018 art. 30 §1º-A · Portarias SPA/MF 1.287/2026, 41/2025 · Portaria MEC 1.240/2024
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-stone-500">Total a recolher</div>
          <div className="font-display text-2xl text-stone-800">{formatBRL(breakdown.total_recolhimento_centavos)}</div>
          <div className="text-xs text-stone-500">{fmtPct(breakdown.effective_total_rate_pct)}% do GGR</div>
        </div>
      </div>

      {/* Resumo por categoria */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 mb-6">
        {cats.map(c => (
          <div key={c.category} className={`border rounded-sm p-3 ${CATEGORY_BADGE[c.category].color}`}>
            <div className="text-[10px] uppercase tracking-wider opacity-80">
              {CATEGORY_BADGE[c.category].label}
            </div>
            <div className="text-sm font-medium mb-1">{labels?.[c.category] ?? c.category}</div>
            <div className="font-display text-lg">{formatBRL(c.total_centavos)}</div>
          </div>
        ))}
      </div>

      {/* Detalhamento por categoria */}
      <div className="space-y-5">
        {cats.map(c => {
          if (Number(c.total_centavos) <= 0 && c.beneficiaries.length === 0) return null;
          const sumPct = c.beneficiaries.reduce((s, b) => s + b.effective_rate_on_ggr, 0);
          return (
            <div key={c.category} className="border border-stone-200 rounded-sm overflow-hidden">
              <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div>
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${CATEGORY_BADGE[c.category].color} mr-2`}>
                      {CATEGORY_BADGE[c.category].label}
                    </span>
                    <span className="font-medium text-stone-800">{labels?.[c.category] ?? c.category}</span>
                    <span className="text-xs text-stone-500 ml-2">· {fmtPct(sumPct)}% do GGR</span>
                  </div>
                  <div className="font-mono font-semibold text-stone-800">{formatBRL(c.total_centavos)}</div>
                </div>
                {descriptions?.[c.category] && (
                  <p className="text-xs text-stone-500 mt-2">{descriptions[c.category]}</p>
                )}
              </div>

              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-stone-500 bg-white">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Beneficiário</th>
                    <th className="text-left px-4 py-2 font-medium">Dispositivo</th>
                    {c.category === 'CONTA_UNICA_TESOURO' && (
                      <th className="text-left px-4 py-2 font-medium">DARF</th>
                    )}
                    <th className="text-right px-4 py-2 font-medium" title="P · Percentual sobre as Destinações Totais (12%)">% das Dest.</th>
                    <th className="text-right px-4 py-2 font-medium" title="Alíquota efetiva = P × 12% / 100">% s/ GGR</th>
                    <th className="text-right px-4 py-2 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {c.beneficiaries.map(b => (
                    <tr key={b.destination.slug} className="border-t border-stone-100">
                      <td className="px-4 py-2 text-stone-800">{b.destination.name}</td>
                      <td className="px-4 py-2 text-stone-500 text-xs">{b.destination.dispositivo}</td>
                      {c.category === 'CONTA_UNICA_TESOURO' && (
                        <td className="px-4 py-2 font-mono text-xs">{b.destination.darf_code ?? '—'}</td>
                      )}
                      <td className="px-4 py-2 text-right text-stone-600 text-xs">{fmtPct(b.destination.percent_of_destinations)}%</td>
                      <td className="px-4 py-2 text-right text-stone-600 text-xs font-mono">{fmtPct(b.effective_rate_on_ggr)}%</td>
                      <td className="px-4 py-2 text-right font-medium font-mono">{formatBRL(b.valor_centavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* FUNAPOL caput escalonado (fora dos 12%) */}
      {breakdown.funapol_caput && (
        <div className="mt-6 border border-rose-200 bg-rose-50/30 rounded-sm p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
            <div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-rose-100 text-rose-800 border-rose-200 mr-2">
                FUNAPOL caput
              </span>
              <span className="font-medium text-rose-900">FUNAPOL — caput escalonado (fora dos 12%)</span>
              <span className="text-xs text-rose-700 ml-2">· {fmtPct(breakdown.funapol_caput.rate_on_ggr)}% do GGR</span>
            </div>
            <div className="font-mono font-semibold text-rose-900">{formatBRL(breakdown.funapol_caput.valor_centavos)}</div>
          </div>
          <p className="text-xs text-rose-700">
            Art. 30, §1º-A, caput · MP 1.348/2026 · Recolhimento via DARF código 5862. Alíquota escalonada: 1% a partir de abril/2026, 2% a partir de jan/2027, 3% a partir de jan/2028. Aplica-se sobre o GGR (após dedução dos incisos III e V do art. 30).
          </p>
        </div>
      )}

      {/* Resumo DARF — agrupado por código de receita para emissão da guia */}
      <div className="mt-6 border border-stone-200 rounded-sm overflow-hidden">
        <div className="bg-blue-50/30 px-4 py-3 border-b border-blue-200">
          <span className="text-sm font-medium text-blue-900">Recolhimento DARF — totais por código de receita</span>
          <p className="text-xs text-blue-700 mt-1">Agrupamento dos valores acima nos códigos da Conta Única do Tesouro (Portaria SPA/MF 1.287/2026). DARF 5862 inclui o FUNAPOL caput.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-stone-500">
            <tr>
              <th className="text-left px-4 py-2">Código DARF</th>
              <th className="text-left px-4 py-2">Descrição</th>
              <th className="text-right px-4 py-2">Valor</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.darf_codes.map(d => (
              <tr key={d.codigo} className="border-t border-stone-100">
                <td className="px-4 py-2 font-mono font-semibold">{d.codigo}{d.includes_funapol_caput && <span className="ml-1 text-[10px] text-rose-700">+FUNAPOL caput</span>}</td>
                <td className="px-4 py-2 text-stone-700 text-xs">{d.descricao}</td>
                <td className="px-4 py-2 text-right font-mono font-medium">{formatBRL(d.total_centavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-stone-500 flex items-start gap-2">
        <FileText className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>
          A coluna "% das Dest." reproduz o Percentual P do Manual SPA/MF (relativo aos 12% das Destinações Totais). A coluna "% s/ GGR" é a alíquota efetiva = P × 12%. As entidades privadas, educação e direitos de imagem são pagas FORA do DARF (transferência bancária ou rateio por competição). A destinação por imagem (7,30%) tem cálculo em duas fases por competição esportiva conforme regulamento (Portaria SPA/MF 41/2025) — o valor consolidado mostrado é apenas o teto agregado.
        </span>
      </div>
    </div>
  );
}
