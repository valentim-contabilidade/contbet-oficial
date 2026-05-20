'use client';

import { useEffect, useState } from 'react';
import { Settings, Save, Building2, Info, CheckCircle, AlertTriangle, FileText, Upload, Download, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import type { CompanyTaxConfig, TaxRegime, PisCofinsRegime, IrpjApurationPeriod } from '@/lib/tax-types';
import { taxRegimeLabels, pisCofinsRegimeLabels, apurationPeriodLabels } from '@/lib/tax-format';
import { PageHeader, Field, Input, Select, PrimaryButton } from '@/components/ui';

interface IssRateSuggestion {
  city: string; state: string; rate: number;
  service_code: string;
  confidence: 'official' | 'common' | 'fallback';
  note?: string;
}

export default function TaxConfigPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [config, setConfig] = useState<CompanyTaxConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [issSuggestion, setIssSuggestion] = useState<IssRateSuggestion | null>(null);

  // Sempre que muda a empresa, busca a sugestão de ISS pela cidade/UF dela
  useEffect(() => {
    if (!companyId) { setIssSuggestion(null); return; }
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    api.get('/tax/iss-rate-suggestion', { params: { city: company.city, state: company.state } })
      .then(r => setIssSuggestion(r.data))
      .catch(() => setIssSuggestion(null));
  }, [companyId, companies]);

  useEffect(() => {
    if (user?.profile !== 'ADMIN') return;
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    });
  }, [user]);

  useEffect(() => {
    if (!companyId || user?.profile !== 'ADMIN') return;
    setLoading(true);
    api.get(`/tax/config/${companyId}`)
      .then(r => setConfig(r.data))
      .finally(() => setLoading(false));
  }, [companyId, user]);

  const handleRegimeChange = (newRegime: PisCofinsRegime) => {
    if (!config) return;
    if (newRegime === 'NAO_CUMULATIVO') {
      setConfig({ ...config, pis_cofins_regime: newRegime, pis_rate: '1.65', cofins_rate: '7.6' });
    } else {
      setConfig({ ...config, pis_cofins_regime: newRegime, pis_rate: '0.65', cofins_rate: '3.0' });
    }
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const payload = {
        company_id: companyId,
        tax_regime: config.tax_regime,
        pis_cofins_regime: config.pis_cofins_regime,
        apuration_period: config.apuration_period,
        pis_rate: parseFloat(config.pis_rate),
        cofins_rate: parseFloat(config.cofins_rate),
        irpj_rate: parseFloat(config.irpj_rate),
        irpj_additional_rate: parseFloat(config.irpj_additional_rate),
        csll_rate: parseFloat(config.csll_rate),
        presumed_irpj_rate: parseFloat(String((config as any).presumed_irpj_rate ?? 32)),
        presumed_csll_rate: parseFloat(String((config as any).presumed_csll_rate ?? 32)),
        iss_rate: parseFloat(String((config as any).iss_rate ?? 5)),
        iss_calculation_base: (config as any).iss_calculation_base ?? 'GGR',
        ggr_methodology: (config as any).ggr_methodology ?? 'OFFICIAL',
        notes: config.notes,
      };
      const res = await api.post('/tax/config', payload);
      setConfig(res.data);
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 3000);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Erro ao salvar.');
    } finally { setSaving(false); }
  };

  if (user?.profile !== 'ADMIN') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Apenas administradores têm acesso à configuração tributária.</div>;
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Configuração Tributária" subtitle="Regime tributário, alíquotas e parâmetros de apuração" />

      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>

      {loading && <div className="text-center text-stone-500 py-8">Carregando...</div>}

      {config && !loading && (
        <>
          {/* Regime Tributário */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <Settings className="w-5 h-5 text-stone-400" />
              <h2 className="font-display text-xl">Regime Tributário</h2>
            </div>

            <div className="grid sm:grid-cols-3 gap-2 mb-4">
              {(['LUCRO_REAL', 'LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL'] as TaxRegime[]).map(r => (
                <button key={r} onClick={() => setConfig({ ...config, tax_regime: r })}
                  className={`px-3 py-3 rounded-sm text-sm border transition ${config.tax_regime === r ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
                  {taxRegimeLabels[r]}
                </button>
              ))}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800">
                Casas de apostas brasileiras geralmente operam em <strong>Lucro Real</strong> devido ao porte e à estrutura societária. Lucro Presumido só é permitido para empresas com receita anual ≤ R$ 78 milhões e atividades específicas.
              </div>
            </div>
          </div>

          {/* PIS / COFINS */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <h2 className="font-display text-xl mb-4">PIS / COFINS</h2>

            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              {(['NAO_CUMULATIVO', 'CUMULATIVO'] as PisCofinsRegime[]).map(r => (
                <button key={r} onClick={() => handleRegimeChange(r)}
                  className={`px-3 py-3 rounded-sm text-sm border transition ${config.pis_cofins_regime === r ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
                  {pisCofinsRegimeLabels[r]}
                </button>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Alíquota PIS (%)">
                <Input type="number" step="0.01" value={config.pis_rate}
                  onChange={e => setConfig({ ...config, pis_rate: e.target.value })} />
              </Field>
              <Field label="Alíquota COFINS (%)">
                <Input type="number" step="0.01" value={config.cofins_rate}
                  onChange={e => setConfig({ ...config, cofins_rate: e.target.value })} />
              </Field>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 mt-4 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                {config.pis_cofins_regime === 'NAO_CUMULATIVO' ? (
                  <>
                    <strong>Não-cumulativo</strong>: alíquotas de 1,65% PIS + 7,60% COFINS. Permite <strong>creditamento</strong> sobre despesas elegíveis (insumos, energia, aluguel, depreciação).
                  </>
                ) : (
                  <>
                    <strong>Cumulativo</strong>: alíquotas de 0,65% PIS + 3,00% COFINS. <strong>Sem direito</strong> a créditos sobre despesas.
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Lucro Presumido — alíquotas de presunção */}
          {config.tax_regime === 'LUCRO_PRESUMIDO' && (
            <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
              <h2 className="font-display text-xl mb-4">Lucro Presumido — Percentuais de Presunção</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Presunção IRPJ (%)">
                  <Input type="number" step="0.01" value={(config as any).presumed_irpj_rate ?? 32}
                    onChange={e => setConfig({ ...(config as any), presumed_irpj_rate: e.target.value })} />
                  <div className="text-xs text-stone-500 mt-1">Padrão: 32% (serviços, jogos). 8% comércio/indústria, 16% transporte.</div>
                </Field>
                <Field label="Presunção CSLL (%)">
                  <Input type="number" step="0.01" value={(config as any).presumed_csll_rate ?? 32}
                    onChange={e => setConfig({ ...(config as any), presumed_csll_rate: e.target.value })} />
                  <div className="text-xs text-stone-500 mt-1">Padrão: 32% (serviços/jogos). 12% comércio/indústria.</div>
                </Field>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 mt-4 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900">
                  No Lucro Presumido, IRPJ e CSLL incidem sobre uma base presumida (receita × percentual), <strong>sem dedução de despesas</strong> e <strong>sem ajustes LALUR</strong>. PIS/COFINS são cumulativos (0,65% + 3,00%).
                </div>
              </div>
            </div>
          )}

          {/* IRPJ + CSLL */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <h2 className="font-display text-xl mb-4">IRPJ + CSLL ({taxRegimeLabels[config.tax_regime]})</h2>

            <div className="mb-4">
              <Field label="Periodicidade da apuração">
                <div className="grid sm:grid-cols-2 gap-2">
                  {(['TRIMESTRAL', 'ANUAL_ESTIMATIVA'] as IrpjApurationPeriod[]).map(p => (
                    <button key={p} type="button" onClick={() => setConfig({ ...config, apuration_period: p })}
                      className={`px-3 py-2.5 rounded-sm text-sm border transition ${config.apuration_period === p ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
                      {apurationPeriodLabels[p]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="IRPJ - Alíquota base (%)">
                <Input type="number" step="0.01" value={config.irpj_rate}
                  onChange={e => setConfig({ ...config, irpj_rate: e.target.value })} />
                <div className="text-xs text-stone-500 mt-1">Padrão: 15%</div>
              </Field>
              <Field label="IRPJ - Adicional (%)">
                <Input type="number" step="0.01" value={config.irpj_additional_rate}
                  onChange={e => setConfig({ ...config, irpj_additional_rate: e.target.value })} />
                <div className="text-xs text-stone-500 mt-1">Padrão: 10%</div>
              </Field>
              <Field label="CSLL (%)">
                <Input type="number" step="0.01" value={config.csll_rate}
                  onChange={e => setConfig({ ...config, csll_rate: e.target.value })} />
                <div className="text-xs text-stone-500 mt-1">Padrão: 9%</div>
              </Field>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-sm p-3 mt-4 flex items-start gap-2">
              <Info className="w-4 h-4 text-purple-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-purple-900">
                <strong>Adicional de IRPJ</strong>: 10% sobre o que excede R$ 60.000/trimestre (ou R$ 20.000/mês, se anual).
                Limites são fixados pela legislação federal e ajustados automaticamente conforme a periodicidade.
              </div>
            </div>
          </div>

          {/* ISS — Imposto sobre Serviços */}
          <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
            <h2 className="font-display text-xl mb-1">ISS · Imposto Sobre Serviços</h2>
            <p className="text-xs text-stone-500 mb-4">Recolhimento municipal sobre receita de serviços. Para casas de apostas, depende da legislação do município sede.</p>

            <Field label="Base de cálculo">
              <div className="grid sm:grid-cols-2 gap-2">
                {(['GGR', 'NGR'] as const).map(b => (
                  <button key={b} type="button"
                    onClick={() => setConfig({ ...(config as any), iss_calculation_base: b })}
                    className={`px-3 py-2.5 rounded-sm text-sm border transition text-left ${(config as any).iss_calculation_base === b ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
                    <div className="font-medium">{b}</div>
                    <div className={`text-[10px] ${(config as any).iss_calculation_base === b ? 'text-stone-300' : 'text-stone-500'}`}>
                      {b === 'GGR' ? 'Receita bruta de jogo (apostas − prêmios)' : 'GGR menos tributo Lei 14.790 (13%)'}
                    </div>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <Field label="Alíquota ISS (%)">
                <div className="flex items-center gap-2">
                  <Input type="number" step="0.01" value={(config as any).iss_rate ?? 5}
                    onChange={e => setConfig({ ...(config as any), iss_rate: e.target.value })} />
                  {issSuggestion && Number((config as any).iss_rate ?? 5) !== issSuggestion.rate && (
                    <button type="button"
                      onClick={() => setConfig({ ...(config as any), iss_rate: String(issSuggestion.rate) })}
                      className="whitespace-nowrap px-2.5 py-1 text-[11px] bg-amber-50 text-amber-900 border border-amber-300 rounded-sm hover:bg-amber-100">
                      usar {issSuggestion.rate}%
                    </button>
                  )}
                </div>
                {issSuggestion && (
                  <div className={`text-xs mt-1 ${issSuggestion.confidence === 'fallback' ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {issSuggestion.confidence === 'official' && '✓ Alíquota oficial '}
                    {issSuggestion.confidence === 'common' && '≈ Alíquota usual '}
                    {issSuggestion.confidence === 'fallback' && '⚠ Município não cadastrado — sugestão de fallback (5%) '}
                    para {issSuggestion.city}/{issSuggestion.state}: <strong>{issSuggestion.rate}%</strong>
                    {issSuggestion.note && <div className="text-[11px] text-stone-600 mt-0.5">{issSuggestion.note}</div>}
                  </div>
                )}
                <div className="text-xs text-stone-500 mt-1">
                  Padrão legal: 2% a 5% (Lei Complementar 116/2003 art. 8-A).
                </div>
              </Field>
            </div>

            <div className="bg-sky-50 border border-sky-200 rounded-sm p-3 mt-4 flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-sky-900">
                Confirme com a prefeitura da sede da empresa a alíquota efetiva e a base aceita. Algumas legislações municipais autorizam GGR; outras só aceitam NGR.
              </div>
            </div>
          </div>

          <GgrMethodologyCard
            companyId={companyId}
            config={config}
            onConfigUpdated={(c: any) => setConfig(c)}
          />

          {/* Botão salvar */}
          <div className="bg-white border border-stone-200 rounded-sm p-4 flex items-center justify-between">
            {savedAt && (
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle className="w-4 h-4" /> Salvo em {savedAt.toLocaleTimeString('pt-BR')}
              </div>
            )}
            {!savedAt && <div></div>}
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? 'Salvando...' : <><Save className="w-4 h-4 inline mr-2" />Salvar configuração</>}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Card de metodologia GGR — opção de abater bônus/cashback com termo assinado
// ============================================================================
type Methodology = 'OFFICIAL' | 'DEDUCT_CASHBACK' | 'DEDUCT_BONUS_CASHBACK';

const methodologyLabels: Record<Methodology, { title: string; formula: string; risk: string }> = {
  OFFICIAL: {
    title: 'Oficial SPA/MF',
    formula: 'GGR = Apostas − Prêmios',
    risk: 'Sem risco fiscal — interpretação Lei 14.790/2023',
  },
  DEDUCT_CASHBACK: {
    title: 'Abatendo Cashback',
    formula: 'GGR = Apostas − Prêmios − Cashback',
    risk: 'Risco fiscal moderado — exige termo de responsabilidade assinado',
  },
  DEDUCT_BONUS_CASHBACK: {
    title: 'Abatendo Bônus e Cashback',
    formula: 'GGR = Apostas − Prêmios − Bônus − Cashback',
    risk: 'Risco fiscal elevado — exige termo de responsabilidade assinado',
  },
};

function GgrMethodologyCard({ companyId, config, onConfigUpdated }: { companyId: string; config: any; onConfigUpdated: (c: any) => void }) {
  const current: Methodology = (config?.ggr_methodology ?? 'OFFICIAL') as Methodology;
  const [selected, setSelected] = useState<Methodology>(current);
  const [uploading, setUploading] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerCpf, setSignerCpf] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const isOfficial = selected === 'OFFICIAL';
  const hasSignedTerm = !!config?.ggr_term_signed_at && config?.ggr_methodology === selected;
  const cpfMask = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  };

  const downloadTermPdf = async () => {
    if (isOfficial) return;
    try {
      const res = await api.get(`/tax/config/${companyId}/ggr-term-pdf`, { params: { methodology: selected }, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `termo-ggr.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao gerar termo.');
    }
  };

  const uploadTerm = async () => {
    setError('');
    if (!file) { setError('Selecione o PDF assinado.'); return; }
    if (!signerName.trim()) { setError('Informe o nome do signatário.'); return; }
    if (signerCpf.replace(/\D/g, '').length !== 11) { setError('CPF inválido.'); return; }

    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(new Uint8Array(arrayBuffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const res = await api.post('/tax/config/ggr-term-upload', {
        company_id: companyId,
        pdf_base64: base64,
        signed_by_name: signerName,
        signed_by_cpf: signerCpf.replace(/\D/g, ''),
        methodology: selected,
      });
      onConfigUpdated(res.data);
      setFile(null); setSignerName(''); setSignerCpf('');
      alert('Termo recebido e ativado. Metodologia agora é: ' + methodologyLabels[selected].title);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao enviar termo.');
    } finally { setUploading(false); }
  };

  const downloadSignedTerm = () => {
    window.open(`/api/tax/config/${companyId}/ggr-term-signed`, '_blank');
  };

  return (
    <div className="bg-white border border-stone-200 rounded-sm p-6">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="w-5 h-5 text-stone-400" />
        <h2 className="font-display text-xl">Metodologia de cálculo do GGR (Lei 14.790)</h2>
      </div>

      <p className="text-sm text-stone-600 mb-4">
        Define a fórmula usada nas apurações mensais de GGR. As opções com abatimento exigem
        termo de responsabilidade assinado pelo representante legal — protege o escritório contábil.
      </p>

      <div className="space-y-2 mb-4">
        {(['OFFICIAL', 'DEDUCT_CASHBACK', 'DEDUCT_BONUS_CASHBACK'] as Methodology[]).map(m => {
          const meta = methodologyLabels[m];
          const isSelected = selected === m;
          const isCurrent = current === m;
          return (
            <label key={m}
              className={`block cursor-pointer border rounded-sm p-3 transition ${isSelected ? 'border-ink bg-stone-50' : 'border-stone-200 hover:border-stone-400'}`}>
              <div className="flex items-start gap-3">
                <input type="radio" name="methodology" checked={isSelected}
                  onChange={() => setSelected(m)} className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{meta.title}</span>
                    {isCurrent && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-green-100 text-green-800 rounded-sm">Em uso</span>}
                  </div>
                  <div className="text-xs text-stone-600 mt-1 font-mono">{meta.formula}</div>
                  <div className={`text-xs mt-1 ${m === 'OFFICIAL' ? 'text-green-700' : m === 'DEDUCT_CASHBACK' ? 'text-amber-700' : 'text-red-700'}`}>
                    {meta.risk}
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {!isOfficial && (
        <div className="border-t border-stone-200 pt-4 mt-4 space-y-4">
          {hasSignedTerm ? (
            <div className="bg-green-50 border border-green-200 rounded-sm p-3 flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-green-900">
                <div className="font-medium">Termo de responsabilidade assinado</div>
                <div className="text-xs text-green-800 mt-0.5">
                  Por: <strong>{config?.ggr_term_signed_by_name}</strong> · CPF: {config?.ggr_term_signed_by_cpf} · Em: {config?.ggr_term_signed_at && new Date(config.ggr_term_signed_at).toLocaleString('pt-BR')}
                </div>
                <button onClick={downloadSignedTerm} className="text-xs text-green-700 underline mt-1 inline-flex items-center gap-1">
                  <Download className="w-3 h-3" /> Baixar termo armazenado
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <div className="font-medium mb-1">Atenção — você está optando por interpretação não-oficial</div>
                  <ul className="text-xs space-y-0.5 list-disc ml-4">
                    <li>A SPA/MF e a Receita Federal podem questionar essa metodologia em fiscalização.</li>
                    <li>Eventuais multas, juros e autuações são <strong>responsabilidade exclusiva da operadora</strong>.</li>
                    <li>O escritório contábil fica isento mediante termo de responsabilidade assinado.</li>
                  </ul>
                </div>
              </div>

              <div className="bg-stone-50 border border-stone-200 rounded-sm p-4">
                <div className="font-medium text-sm mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Passo 1 — Baixar termo pré-preenchido
                </div>
                <p className="text-xs text-stone-600 mb-2">
                  PDF com os dados da empresa para o representante legal assinar.
                </p>
                <button type="button" onClick={downloadTermPdf}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-ink text-stone-100 text-xs rounded-sm hover:bg-ink/90">
                  <Download className="w-3.5 h-3.5" /> Baixar termo pré-preenchido (PDF)
                </button>
              </div>

              <div className="bg-stone-50 border border-stone-200 rounded-sm p-4">
                <div className="font-medium text-sm mb-2 flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Passo 2 — Enviar termo assinado
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Nome do signatário" required>
                    <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Representante legal" />
                  </Field>
                  <Field label="CPF do signatário" required>
                    <Input value={signerCpf} onChange={e => setSignerCpf(cpfMask(e.target.value))} placeholder="000.000.000-00" maxLength={14} />
                  </Field>
                </div>
                <div className="mt-3">
                  <label className="text-xs text-stone-500 uppercase tracking-wider block mb-1">PDF assinado *</label>
                  <input type="file" accept=".pdf,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
                </div>
                {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm mt-3">{error}</div>}
                <div className="mt-3">
                  <button type="button" onClick={uploadTerm} disabled={uploading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-700 text-white text-sm rounded-sm hover:bg-amber-800 disabled:opacity-50">
                    <Upload className="w-4 h-4" /> {uploading ? 'Enviando…' : 'Enviar termo e ativar metodologia'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
