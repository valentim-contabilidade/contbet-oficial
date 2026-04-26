'use client';

import { useEffect, useState } from 'react';
import { Settings, Save, Building2, Info, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import type { CompanyTaxConfig, TaxRegime, PisCofinsRegime, IrpjApurationPeriod } from '@/lib/tax-types';
import { taxRegimeLabels, pisCofinsRegimeLabels, apurationPeriodLabels } from '@/lib/tax-format';
import { PageHeader, Field, Input, Select, PrimaryButton } from '@/components/ui';

export default function TaxConfigPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [config, setConfig] = useState<CompanyTaxConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

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
                      {b === 'GGR' ? 'Receita bruta de jogo (apostas − prêmios)' : 'GGR menos tributo Lei 14.790 (12%)'}
                    </div>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <Field label="Alíquota ISS (%)">
                <Input type="number" step="0.01" value={(config as any).iss_rate ?? 5}
                  onChange={e => setConfig({ ...(config as any), iss_rate: e.target.value })} />
                <div className="text-xs text-stone-500 mt-1">
                  Padrão: 5%. Varia por município entre 2% e 5% (Lei Complementar 116/2003).
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
