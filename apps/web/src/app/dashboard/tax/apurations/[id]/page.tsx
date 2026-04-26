'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calculator, Lock, Unlock, AlertTriangle, TrendingUp, TrendingDown, FileText, Plus, Trash2, Receipt, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBRL, formatDate } from '@/lib/format';
import { PageHeader, Modal, PrimaryButton, SecondaryButton, Field, Input, Select } from '@/components/ui';
import { CurrencyInput } from '@/components/financial-ui';
import type { IrpjCsllApuration, LalurAdjustment, LalurAdjustmentType } from '@/lib/tax-types';
import { irpjStatusLabels, irpjStatusColors, lalurTypeLabels, formatPeriod } from '@/lib/tax-format';

function AddLalurModal({ apurationId, onAdd, onCancel }: { apurationId: string; onAdd: () => Promise<void>; onCancel: () => void }) {
  const [data, setData] = useState({
    type: 'ADDITION' as LalurAdjustmentType,
    description: '',
    amount: 0,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!data.description.trim()) errs.description = 'Descrição obrigatória';
    if (data.amount < 1) errs.amount = 'Valor obrigatório';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        await api.post(`/tax/irpj/${apurationId}/lalur`, {
          type: data.type,
          description: data.description,
          amount: data.amount,
          notes: data.notes,
        });
        await onAdd();
      } catch (err: any) {
        setErrors({ form: err.response?.data?.message ?? 'Erro' });
      } finally { setSubmitting(false); }
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Tipo de ajuste" required>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setData({ ...data, type: 'ADDITION' })}
            className={`px-3 py-3 rounded-sm text-sm border transition ${data.type === 'ADDITION' ? 'bg-red-50 border-red-300 text-red-900 font-medium' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <ArrowUpCircle className="w-4 h-4 inline mr-2" />
            Adição (aumenta lucro)
          </button>
          <button type="button" onClick={() => setData({ ...data, type: 'EXCLUSION' })}
            className={`px-3 py-3 rounded-sm text-sm border transition ${data.type === 'EXCLUSION' ? 'bg-green-50 border-green-300 text-green-900 font-medium' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <ArrowDownCircle className="w-4 h-4 inline mr-2" />
            Exclusão (reduz lucro)
          </button>
        </div>
      </Field>

      <Field label="Descrição" required error={errors.description}>
        <Input value={data.description} onChange={e => setData({ ...data, description: e.target.value })}
          placeholder={data.type === 'ADDITION' ? 'Ex: Multas indedutíveis, IRPJ/CSLL contabilizado, Doações não dedutíveis...' : 'Ex: Receitas isentas, Provisão revertida, Equivalência patrimonial positiva...'} />
      </Field>

      <Field label="Valor" required error={errors.amount}>
        <CurrencyInput value={data.amount} onChange={v => setData({ ...data, amount: v })} />
      </Field>

      <Field label="Notas / Justificativa">
        <textarea value={data.notes} onChange={e => setData({ ...data, notes: e.target.value })}
          placeholder="Justificativa técnica do ajuste, base legal, documento de referência..."
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>

      <div className="bg-blue-50 border border-blue-200 rounded-sm px-4 py-3 text-xs text-blue-800">
        💡 <strong>Adições</strong> aumentam o lucro tributável (ex: despesas não dedutíveis pelo Fisco). <strong>Exclusões</strong> reduzem o lucro tributável (ex: receitas que não compõem a base do IRPJ).
      </div>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Adicionando...' : 'Adicionar ajuste'}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function TaxApurationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<IrpjCsllApuration | null>(null);
  const [loading, setLoading] = useState(true);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lalurOpen, setLalurOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/tax/irpj/${id}`);
      setData(res.data);
    } finally { setLoading(false); }
  };

  // Recalcula buscando dados frescos das despesas/receitas
  const recalc = async () => {
    if (!data) return;
    const payload: any = {
      company_id: data.company_id,
      year: data.year,
    };
    if (data.quarter) payload.quarter = data.quarter;
    if (data.month) payload.month = data.month;
    await api.post('/tax/irpj/calculate', payload);
    await reload();
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [id]);

  const handleClose = async () => {
    setSubmitting(true);
    try {
      const res = await api.post(`/tax/irpj/${id}/close`, { notes: closeNotes });
      setCloseOpen(false);
      const generated = res.data.generated_payables?.length || 0;
      alert(`Apuração fechada! ${generated} contas a pagar foram geradas e estão disponíveis em Financeiro → Contas a Pagar.`);
      await reload();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro');
    } finally { setSubmitting(false); }
  };

  const handleReopen = async () => {
    if (!confirm('Reabrir? As contas a pagar pendentes serão canceladas.')) return;
    try {
      await api.post(`/tax/irpj/${id}/reopen`);
      await reload();
    } catch (err: any) { alert(err.response?.data?.message ?? 'Erro'); }
  };

  const handleDeleteAdjustment = async (adjId: string) => {
    if (!confirm('Remover este ajuste?')) return;
    await api.delete(`/tax/lalur/${adjId}`);
    await reload();
  };

  if (loading) return <div className="text-center text-stone-500 py-20">Carregando apuração...</div>;
  if (!data) return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Apuração não encontrada.</div>;

  const isOpen = data.status === 'OPEN';
  const isClosed = data.status === 'CLOSED';
  const adjustments = data.lalur_adjustments || [];

  return (
    <div>
      <Link href="/dashboard/tax/apurations" className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar para apurações
      </Link>

      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">IRPJ + CSLL · Lucro Real</div>
            <h1 className="font-display text-3xl mb-2">{formatPeriod(data)}</h1>
            <div className="text-sm text-stone-600">
              <strong>{data.company?.name}</strong>
              {data.closed_at && <> · Fechada em {formatDate(data.closed_at)}</>}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-xs px-3 py-1.5 rounded-sm uppercase tracking-wider ${irpjStatusColors[data.status]}`}>
              {irpjStatusLabels[data.status]}
            </span>
            {isOpen && (
              <>
                <SecondaryButton onClick={recalc}>
                  <Calculator className="w-4 h-4 inline mr-2" /> Recalcular
                </SecondaryButton>
                <PrimaryButton onClick={() => setCloseOpen(true)}>
                  <Lock className="w-4 h-4 inline mr-2" /> Fechar e gerar impostos
                </PrimaryButton>
              </>
            )}
            {isClosed && (
              <SecondaryButton onClick={handleReopen}>
                <Unlock className="w-4 h-4 inline mr-2" /> Reabrir
              </SecondaryButton>
            )}
          </div>
        </div>
      </div>

      {/* DRE simplificada - 4 cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-stone-200 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-green-700" strokeWidth={1.5} />
            <span className="text-xs uppercase tracking-wider text-stone-500">Receitas</span>
          </div>
          <div className="font-display text-2xl text-green-800">{formatBRL(data.total_revenue)}</div>
          <div className="text-xs text-stone-500 mt-2">
            GGR: {formatBRL(data.ggr_revenue)}<br />
            Outras: {formatBRL(data.other_revenue)}
          </div>
        </div>

        <div className="bg-white border border-stone-200 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-red-600" strokeWidth={1.5} />
            <span className="text-xs uppercase tracking-wider text-stone-500">Despesas dedutíveis</span>
          </div>
          <div className="font-display text-2xl text-red-700">{formatBRL(data.deductible_expenses)}</div>
          <div className="text-xs text-stone-500 mt-2">Contas a pagar pagas no período</div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-amber-700" strokeWidth={1.5} />
            <span className="text-xs uppercase tracking-wider text-amber-800">Lucro Real</span>
          </div>
          <div className={`font-display text-2xl ${Number(data.taxable_profit) >= 0 ? 'text-amber-900' : 'text-red-700'}`}>
            {formatBRL(data.taxable_profit)}
          </div>
          <div className="text-xs text-amber-700 mt-2">Base de cálculo IRPJ/CSLL</div>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-red-100/50 border border-red-200 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="w-4 h-4 text-red-700" strokeWidth={1.5} />
            <span className="text-xs uppercase tracking-wider text-red-800">IRPJ + CSLL</span>
          </div>
          <div className="font-display text-2xl text-red-900">{formatBRL(data.total_taxes)}</div>
          <div className="text-xs text-red-700 mt-2">{isOpen ? 'Estimativa' : 'Confirmado'}</div>
        </div>
      </div>

      {/* Memória de cálculo */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Memória de cálculo</h2>

        <div className="space-y-3 font-mono text-sm">
          <div className="flex justify-between items-center pb-2 border-b border-stone-200">
            <span className="text-stone-700">(+) Receita total</span>
            <span className="text-green-800">{formatBRL(data.total_revenue)}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-stone-200">
            <span className="text-stone-700">(−) Despesas dedutíveis</span>
            <span className="text-red-700">−{formatBRL(data.deductible_expenses)}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-stone-200 font-medium">
            <span className="text-stone-900">(=) Lucro contábil</span>
            <span className={Number(data.accounting_profit) >= 0 ? 'text-stone-900' : 'text-red-700'}>{formatBRL(data.accounting_profit)}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-stone-200">
            <span className="text-stone-700">(+) Adições LALUR</span>
            <span className="text-stone-900">+{formatBRL(data.total_additions)}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-stone-200">
            <span className="text-stone-700">(−) Exclusões LALUR</span>
            <span className="text-stone-900">−{formatBRL(data.total_exclusions)}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b-2 border-amber-300 font-medium pt-1">
            <span className="text-amber-900">(=) Lucro Real (base)</span>
            <span className={`text-lg ${Number(data.taxable_profit) >= 0 ? 'text-amber-900' : 'text-red-700'}`}>{formatBRL(data.taxable_profit)}</span>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-stone-200">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="border border-blue-200 bg-blue-50/30 rounded-sm p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="text-xs uppercase tracking-wider text-blue-800 font-medium">IRPJ Base</div>
                <span className="text-xs bg-blue-200 text-blue-900 px-2 py-0.5 rounded-sm font-mono">{data.irpj_rate}%</span>
              </div>
              <div className="font-display text-xl text-blue-900">{formatBRL(data.irpj_base_amount)}</div>
              <div className="text-xs text-blue-700 mt-1">{data.irpj_rate}% × Lucro Real</div>
            </div>

            <div className="border border-purple-200 bg-purple-50/30 rounded-sm p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="text-xs uppercase tracking-wider text-purple-800 font-medium">IRPJ Adicional</div>
                <span className="text-xs bg-purple-200 text-purple-900 px-2 py-0.5 rounded-sm font-mono">{data.irpj_additional_rate}%</span>
              </div>
              <div className="font-display text-xl text-purple-900">{formatBRL(data.irpj_additional_amount)}</div>
              <div className="text-xs text-purple-700 mt-1">Sobre o que excede {formatBRL(data.irpj_additional_threshold)}</div>
            </div>

            <div className="border border-rose-200 bg-rose-50/30 rounded-sm p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="text-xs uppercase tracking-wider text-rose-800 font-medium">CSLL</div>
                <span className="text-xs bg-rose-200 text-rose-900 px-2 py-0.5 rounded-sm font-mono">{data.csll_rate}%</span>
              </div>
              <div className="font-display text-xl text-rose-900">{formatBRL(data.csll_amount)}</div>
              <div className="text-xs text-rose-700 mt-1">{data.csll_rate}% × Lucro Real</div>
            </div>
          </div>
        </div>
      </div>

      {/* LALUR */}
      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl">LALUR — Ajustes do Lucro Real</h2>
            <p className="text-xs text-stone-500 mt-1">{adjustments.length} {adjustments.length === 1 ? 'ajuste' : 'ajustes'} cadastrados</p>
          </div>
          {isOpen && (
            <button onClick={() => setLalurOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-stone-100 hover:bg-stone-200 rounded-sm transition">
              <Plus className="w-4 h-4" /> Adicionar ajuste
            </button>
          )}
        </div>
        {adjustments.length === 0 && (
          <div className="px-6 py-8 text-center text-stone-500 text-sm">
            Nenhum ajuste cadastrado. Os ajustes do LALUR são raros e específicos — em muitos casos não há ajustes a fazer.
          </div>
        )}
        {adjustments.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Descrição</th>
                <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Valor</th>
                {isOpen && <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {adjustments.map(adj => (
                <tr key={adj.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider ${
                      adj.type === 'ADDITION' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      {lalurTypeLabels[adj.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div>{adj.description}</div>
                    {adj.notes && <div className="text-xs text-stone-500 mt-0.5">{adj.notes}</div>}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${adj.type === 'ADDITION' ? 'text-red-700' : 'text-green-700'}`}>
                    {adj.type === 'ADDITION' ? '+' : '−'}{formatBRL(adj.amount)}
                  </td>
                  {isOpen && (
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleDeleteAdjustment(adj.id)}
                        className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de fechamento */}
      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Fechar apuração e gerar impostos" size="md">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-sm p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="mb-2"><strong>Esta ação irá:</strong></p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Travar a apuração para edição</li>
                  <li>Gerar contas a pagar:</li>
                </ol>
                <ul className="ml-6 mt-2 space-y-1 list-disc list-inside">
                  {Number(data.irpj_total) > 0 && <li>IRPJ: <strong>{formatBRL(data.irpj_total)}</strong></li>}
                  {Number(data.csll_amount) > 0 && <li>CSLL: <strong>{formatBRL(data.csll_amount)}</strong></li>}
                </ul>
                {Number(data.total_taxes) === 0 && <p className="mt-2 text-amber-700">Não há impostos a pagar (lucro real ≤ 0).</p>}
              </div>
            </div>
          </div>
          <Field label="Observações (opcional)">
            <textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)}
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
            <SecondaryButton type="button" onClick={() => setCloseOpen(false)}>Cancelar</SecondaryButton>
            <PrimaryButton type="button" onClick={handleClose} disabled={submitting}>
              {submitting ? 'Processando...' : <><Lock className="w-4 h-4 inline mr-2" /> Confirmar fechamento</>}
            </PrimaryButton>
          </div>
        </div>
      </Modal>

      <Modal open={lalurOpen} onClose={() => setLalurOpen(false)} title="Adicionar ajuste LALUR" size="md">
        <AddLalurModal apurationId={id} onAdd={async () => { setLalurOpen(false); await reload(); }} onCancel={() => setLalurOpen(false)} />
      </Modal>
    </div>
  );
}
