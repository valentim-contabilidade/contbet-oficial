'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calculator, Lock, Unlock, AlertTriangle, ShieldCheck, ShieldAlert, ShieldX, TrendingUp, TrendingDown, Receipt, FileText, Calendar, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBRL, formatDate, monthNames } from '@/lib/format';
import { PageHeader, Modal, PrimaryButton, SecondaryButton, Field } from '@/components/ui';
import type { MonthlyApurationResponse } from '@/lib/ggr-types';

const apurationStatusLabels: Record<string, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  PAID: 'Paga',
};

export default function MonthlyApurationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = params.brandId as string;
  const year = parseInt(params.year as string);
  const month = parseInt(params.month as string);

  const [data, setData] = useState<MonthlyApurationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/ggr/monthly/${brandId}/${year}/${month}`);
      setData(res.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [brandId, year, month]);

  const handleClose = async () => {
    setSubmitting(true);
    try {
      const res = await api.post(`/ggr/monthly/${brandId}/${year}/${month}/close`, { notes: closeNotes });
      setCloseModalOpen(false);
      const generated = res.data.generated_payables?.length || 0;
      alert(`Apuração fechada! ${generated} contas a pagar foram geradas e estão disponíveis no módulo Financeiro → Contas a Pagar.`);
      await reload();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro ao fechar apuração.');
    } finally { setSubmitting(false); }
  };

  const handleReopen = async () => {
    if (!confirm('Reabrir esta apuração? As contas a pagar pendentes geradas serão canceladas.')) return;
    try {
      await api.post(`/ggr/monthly/${brandId}/${year}/${month}/reopen`);
      await reload();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro.');
    }
  };

  if (loading) return <div className="text-center text-stone-500 py-20">Carregando apuração...</div>;
  if (!data) return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Apuração não encontrada.</div>;

  const { apuration, daily_records, segregation } = data;
  const isOpen = apuration.status === 'OPEN';
  const isClosed = apuration.status === 'CLOSED';

  // Componentes de alerta de segregação
  const segIcon = segregation.alert_level === 'OK' ? ShieldCheck :
                  segregation.alert_level === 'WARNING' ? ShieldAlert : ShieldX;
  const segColor = segregation.alert_level === 'OK' ? 'green' :
                    segregation.alert_level === 'WARNING' ? 'amber' : 'red';
  const SegIconComponent = segIcon;

  return (
    <div>
      <Link href="/dashboard/ggr/apurations" className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar para apurações
      </Link>

      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Apuração mensal</div>
            <h1 className="font-display text-3xl mb-2">{monthNames[month - 1]}/{year}</h1>
            <div className="text-sm text-stone-600">
              <strong>{apuration.brand?.name}</strong>
              {apuration.closed_at && <> · Fechada em {formatDate(apuration.closed_at)}</>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-3 py-1.5 rounded-sm uppercase tracking-wider ${
              apuration.status === 'OPEN' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
              apuration.status === 'CLOSED' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
              'bg-green-50 text-green-700 border border-green-200'
            }`}>
              {apurationStatusLabels[apuration.status]}
            </span>
            {isOpen && (
              <PrimaryButton onClick={() => setCloseModalOpen(true)}>
                <Lock className="w-4 h-4 inline mr-2" /> Fechar e gerar impostos
              </PrimaryButton>
            )}
            {isClosed && (
              <SecondaryButton onClick={handleReopen}>
                <Unlock className="w-4 h-4 inline mr-2" /> Reabrir
              </SecondaryButton>
            )}
          </div>
        </div>

        {apuration.notes && (
          <div className="mt-4 pt-4 border-t border-stone-200 text-sm text-stone-700">
            <strong className="text-stone-500">Observações:</strong> {apuration.notes}
          </div>
        )}
      </div>

      {/* Alerta de Segregação Patrimonial */}
      {segregation.alert_level !== 'OK' && (
        <div className={`bg-${segColor}-50 border border-${segColor}-300 rounded-sm p-5 mb-6`}>
          <div className="flex items-start gap-4">
            <SegIconComponent className={`w-8 h-8 text-${segColor}-700 flex-shrink-0 mt-0.5`} />
            <div className="flex-1">
              <h3 className={`font-medium text-${segColor}-900 mb-1`}>
                {segregation.alert_level === 'CRITICAL' ? 'ALERTA CRÍTICO de Segregação Patrimonial' : 'Atenção: divergência na segregação patrimonial'}
              </h3>
              <p className={`text-sm text-${segColor}-800 mb-3`}>
                A Lei 14.790 determina que o saldo das contas dos jogadores seja <strong>segregado</strong> em conta bancária específica da operadora.
                A divergência abaixo {segregation.alert_level === 'CRITICAL' ? 'é grave e pode indicar uso indevido dos fundos dos apostadores' : 'sugere uma diferença que merece investigação'}.
              </p>
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div className={`bg-white border border-${segColor}-200 rounded-sm p-3`}>
                  <div className={`text-xs uppercase tracking-wider text-${segColor}-700 mb-1`}>Saldo esperado de jogadores</div>
                  <div className="font-mono font-medium">{formatBRL(segregation.expected_players_balance)}</div>
                </div>
                <div className={`bg-white border border-${segColor}-200 rounded-sm p-3`}>
                  <div className={`text-xs uppercase tracking-wider text-${segColor}-700 mb-1`}>Saldo bancário real</div>
                  <div className="font-mono font-medium">{formatBRL(segregation.actual_bank_balance)}</div>
                </div>
                <div className={`bg-white border border-${segColor}-200 rounded-sm p-3`}>
                  <div className={`text-xs uppercase tracking-wider text-${segColor}-700 mb-1`}>Divergência</div>
                  <div className={`font-mono font-medium text-${segColor}-900`}>{formatBRL(segregation.divergence)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {segregation.alert_level === 'OK' && Number(segregation.expected_players_balance) !== 0 && (
        <div className="bg-green-50 border border-green-200 rounded-sm p-4 mb-6 flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-green-700" />
          <div className="text-sm text-green-900">
            <strong>Segregação patrimonial OK</strong> · Saldo esperado de jogadores ({formatBRL(segregation.expected_players_balance)}) está coberto pelo saldo bancário consolidado.
          </div>
        </div>
      )}

      {/* Grid principal: 3 colunas */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Volume operacional */}
        <div className="bg-white border border-stone-200 rounded-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="w-5 h-5 text-stone-400" />
            <h2 className="font-medium text-sm uppercase tracking-wider text-stone-700">Volume operacional</h2>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-stone-600">Apostas</span>
              <span className="font-mono">{formatBRL(apuration.total_bets)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-stone-600">Prêmios pagos</span>
              <span className="font-mono text-red-700">−{formatBRL(apuration.total_prizes)}</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-stone-200">
              <span className="text-sm font-medium text-amber-800">GGR</span>
              <span className={`font-mono font-medium text-lg ${Number(apuration.ggr) >= 0 ? 'text-amber-800' : 'text-red-700'}`}>
                {formatBRL(apuration.ggr)}
              </span>
            </div>
          </div>
        </div>

        {/* Movimento de carteira */}
        <div className="bg-white border border-stone-200 rounded-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-stone-400" />
            <h2 className="font-medium text-sm uppercase tracking-wider text-stone-700">Carteira de jogadores</h2>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-stone-600">Depósitos</span>
              <span className="font-mono text-green-700">+{formatBRL(apuration.total_deposits)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-stone-600">Saques</span>
              <span className="font-mono text-red-700">−{formatBRL(apuration.total_withdrawals)}</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-stone-200">
              <span className="text-sm font-medium text-stone-700">Saldo líquido</span>
              <span className="font-mono font-medium text-lg">
                {formatBRL(Number(apuration.total_deposits) - Number(apuration.total_withdrawals))}
              </span>
            </div>
          </div>
        </div>

        {/* Quadro síntese */}
        <div className="bg-gradient-to-br from-red-50 to-red-100/50 border border-red-200 rounded-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="w-5 h-5 text-red-700" />
            <h2 className="font-medium text-sm uppercase tracking-wider text-red-800">Total de impostos</h2>
          </div>
          <div className="text-xs text-red-700 mb-2">{monthNames[month - 1]}/{year}</div>
          <div className="font-display text-3xl text-red-900 mb-3">{formatBRL(apuration.total_taxes)}</div>
          <div className="text-xs text-red-700">
            {isOpen && '💡 Estimativa — fechar a apuração gera as contas a pagar definitivas'}
            {isClosed && '✓ Apuração fechada · contas a pagar geradas no Financeiro'}
            {apuration.status === 'PAID' && '✓ Impostos pagos'}
          </div>
        </div>
      </div>

      {/* Detalhamento dos 4 impostos */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Detalhamento tributário</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-blue-200 bg-blue-50/30 rounded-sm p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-blue-800 font-medium">Lei 14.790</div>
                <div className="text-xs text-blue-700">Imposto sobre apostas</div>
              </div>
              <span className="text-xs bg-blue-200 text-blue-900 px-2 py-0.5 rounded-sm font-mono">{apuration.tax_lei14790_rate}%</span>
            </div>
            <div className="font-display text-xl text-blue-900 mb-1">{formatBRL(apuration.tax_lei14790_amount)}</div>
            <div className="text-xs text-blue-700">Base: receita líquida (GGR)</div>
          </div>
          <div className="border border-purple-200 bg-purple-50/30 rounded-sm p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-purple-800 font-medium">IRRF</div>
                <div className="text-xs text-purple-700">Sobre prêmios</div>
              </div>
              <span className="text-xs bg-purple-200 text-purple-900 px-2 py-0.5 rounded-sm font-mono">{apuration.irrf_rate}%</span>
            </div>
            <div className="font-display text-xl text-purple-900 mb-1">{formatBRL(apuration.irrf_amount)}</div>
            <div className="text-xs text-purple-700">Base: {formatBRL(apuration.irrf_taxable_base)}</div>
          </div>
          <div className="border border-amber-200 bg-amber-50/30 rounded-sm p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-amber-800 font-medium">PIS</div>
                <div className="text-xs text-amber-700">Sobre receita</div>
              </div>
              <span className="text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-sm font-mono">{apuration.pis_rate}%</span>
            </div>
            <div className="font-display text-xl text-amber-900 mb-1">{formatBRL(apuration.pis_amount)}</div>
            <div className="text-xs text-amber-700">Base: receita</div>
          </div>
          <div className="border border-rose-200 bg-rose-50/30 rounded-sm p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-rose-800 font-medium">COFINS</div>
                <div className="text-xs text-rose-700">Sobre receita</div>
              </div>
              <span className="text-xs bg-rose-200 text-rose-900 px-2 py-0.5 rounded-sm font-mono">{apuration.cofins_rate}%</span>
            </div>
            <div className="font-display text-xl text-rose-900 mb-1">{formatBRL(apuration.cofins_amount)}</div>
            <div className="text-xs text-rose-700">Base: receita</div>
          </div>
        </div>
      </div>

      {/* Tabela de registros diários */}
      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl">Registros diários do período</h2>
            <p className="text-xs text-stone-500 mt-1">{daily_records.length} {daily_records.length === 1 ? 'dia registrado' : 'dias registrados'}</p>
          </div>
          <Link href={`/dashboard/ggr/import`} className="text-xs text-ink hover:underline">+ Adicionar mais dados</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Data</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Apostas</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Prêmios</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-amber-700">GGR</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Depósitos</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Saques</th>
              </tr>
            </thead>
            <tbody>
              {daily_records.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-stone-500">Nenhum registro diário neste período. Importe os dados.</td></tr>
              )}
              {daily_records.map(r => (
                <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs">{formatDate(r.date)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatBRL(r.total_bets)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-700">{formatBRL(r.total_prizes)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${Number(r.ggr) >= 0 ? 'text-amber-800' : 'text-red-700'}`}>
                    {formatBRL(r.ggr)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-stone-700">{formatBRL(r.total_deposits)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-stone-700">{formatBRL(r.total_withdrawals)}</td>
                </tr>
              ))}
            </tbody>
            {daily_records.length > 0 && (
              <tfoot className="bg-stone-50 border-t-2 border-stone-300 font-medium">
                <tr>
                  <td className="px-4 py-3 text-xs uppercase tracking-wider text-stone-700">TOTAL</td>
                  <td className="px-4 py-3 text-right font-mono">{formatBRL(apuration.total_bets)}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-700">{formatBRL(apuration.total_prizes)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-800">{formatBRL(apuration.ggr)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatBRL(apuration.total_deposits)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatBRL(apuration.total_withdrawals)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal de fechamento */}
      <Modal open={closeModalOpen} onClose={() => setCloseModalOpen(false)} title="Fechar apuração e gerar impostos" size="md">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-sm p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="mb-2"><strong>Esta ação irá:</strong></p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Travar a apuração para edição</li>
                  <li>Gerar contas a pagar para cada imposto:</li>
                </ol>
                <ul className="ml-6 mt-2 space-y-1 list-disc list-inside">
                  {Number(apuration.tax_lei14790_amount) > 0 && <li>Lei 14.790: <strong>{formatBRL(apuration.tax_lei14790_amount)}</strong></li>}
                  {Number(apuration.irrf_amount) > 0 && <li>IRRF: <strong>{formatBRL(apuration.irrf_amount)}</strong></li>}
                  {Number(apuration.pis_amount) > 0 && <li>PIS: <strong>{formatBRL(apuration.pis_amount)}</strong></li>}
                  {Number(apuration.cofins_amount) > 0 && <li>COFINS: <strong>{formatBRL(apuration.cofins_amount)}</strong></li>}
                </ul>
                <p className="mt-2">Vencimento: <strong>20/{String(month + 1).padStart(2, '0')}/{month === 12 ? year + 1 : year}</strong></p>
              </div>
            </div>
          </div>
          <Field label="Observações (opcional)">
            <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
              placeholder="Notas sobre o fechamento desta apuração..."
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
            <SecondaryButton type="button" onClick={() => setCloseModalOpen(false)}>Cancelar</SecondaryButton>
            <PrimaryButton type="button" onClick={handleClose} disabled={submitting}>
              {submitting ? 'Processando...' : <><Lock className="w-4 h-4 inline mr-2" /> Confirmar fechamento</>}
            </PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
