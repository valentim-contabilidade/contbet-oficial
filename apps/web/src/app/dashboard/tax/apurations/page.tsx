'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calculator, Eye, Calendar, Lock, Unlock, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, monthNames } from '@/lib/format';
import { PageHeader, FilterBar, Modal, PrimaryButton, SecondaryButton, Field, Select, Input } from '@/components/ui';
import type { Company } from '@/lib/types';
import { irpjStatusLabels, irpjStatusColors, formatPeriod, quarterLabel } from '@/lib/tax-format';

type TaxType = 'IRPJ_CSLL' | 'PIS_COFINS' | 'ISS';
type TaxChoice = TaxType | 'ALL';

interface UnifiedApuration {
  id: string;
  source_id: string;
  tax_type: TaxType;
  period_type: 'TRIMESTRAL' | 'ANUAL_ESTIMATIVA' | 'MENSAL';
  year: number;
  quarter: number | null;
  month: number | null;
  base_amount: string;
  tax_amount: string;
  status: 'OPEN' | 'CLOSED' | 'PAID';
  calculation_base?: 'GGR' | 'NGR';
  company?: { id: string; name: string };
}

const taxLabels: Record<TaxType, string> = {
  IRPJ_CSLL: 'IRPJ + CSLL',
  PIS_COFINS: 'PIS + COFINS',
  ISS: 'ISS',
};

const taxColors: Record<TaxType, string> = {
  IRPJ_CSLL: 'bg-amber-50 text-amber-800 border border-amber-200',
  PIS_COFINS: 'bg-purple-50 text-purple-800 border border-purple-200',
  ISS: 'bg-sky-50 text-sky-800 border border-sky-200',
};

const statusIcons: Record<string, any> = {
  OPEN: Unlock,
  CLOSED: Lock,
  PAID: CheckCircle2,
};

function CalculateModal({ companies, current, onCalculated, onCancel }: {
  companies: Company[]; current: any; onCalculated: (taxType: TaxChoice, res: any) => Promise<void>; onCancel: () => void;
}) {
  const today = new Date();
  const currentQuarter = Math.floor(today.getMonth() / 3) + 1;
  const [taxType, setTaxType] = useState<TaxChoice>('ALL');
  const [data, setData] = useState({
    company_id: current.profile === 'MANAGER' ? current.company_id : '',
    period_type: 'TRIMESTRAL' as 'TRIMESTRAL' | 'ANUAL_ESTIMATIVA',
    year: today.getFullYear(),
    quarter: currentQuarter,
    month: today.getMonth() + 1,
  });
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string>('');

  const callOne = async (type: TaxType): Promise<{ type: TaxType; res: any }> => {
    const payload: any = { company_id: data.company_id, year: data.year };
    let url: string;
    if (type === 'IRPJ_CSLL') {
      url = '/tax/irpj/calculate';
      // No modo "Todos", o IRPJ é sempre trimestral (com base no mês escolhido)
      const q = taxType === 'ALL' ? Math.floor((data.month - 1) / 3) + 1 : data.quarter;
      if (taxType === 'ALL' || data.period_type === 'TRIMESTRAL') payload.quarter = q;
      else payload.month = data.month;
    } else if (type === 'PIS_COFINS') {
      url = '/tax/pis-cofins/calculate';
      payload.month = data.month;
    } else {
      url = '/tax/iss/calculate';
      payload.month = data.month;
    }
    const res = await api.post(url, payload);
    return { type, res: res.data };
  };

  const submit = async () => {
    if (!data.company_id) return;
    setSubmitting(true);
    setProgress('');
    try {
      if (taxType === 'ALL') {
        const types: TaxType[] = ['IRPJ_CSLL', 'PIS_COFINS', 'ISS'];
        let last: any = null;
        for (let i = 0; i < types.length; i++) {
          setProgress(`Calculando ${taxLabels[types[i]]} (${i + 1}/${types.length})…`);
          last = await callOne(types[i]);
        }
        await onCalculated('ALL', last?.res);
      } else {
        const out = await callOne(taxType);
        await onCalculated(taxType, out.res);
      }
    } finally { setSubmitting(false); setProgress(''); }
  };

  return (
    <div className="space-y-4">
      <Field label="Imposto" required>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTaxType('ALL')}
            className={`px-3 py-2.5 rounded-sm text-sm border transition ${taxType === 'ALL' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
            Todos os impostos
          </button>
          {(['IRPJ_CSLL', 'PIS_COFINS', 'ISS'] as TaxType[]).map(t => (
            <button key={t} type="button" onClick={() => setTaxType(t)}
              className={`px-3 py-2.5 rounded-sm text-sm border transition ${taxType === t ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
              {taxLabels[t]}
            </button>
          ))}
        </div>
        {taxType === 'ALL' && (
          <div className="text-xs text-stone-500 mt-2">
            Calcula IRPJ/CSLL (trimestral, do trimestre que contém o mês escolhido) + PIS/COFINS + ISS em sequência.
          </div>
        )}
      </Field>

      <Field label="Empresa" required>
        <Select value={data.company_id} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
          <option value="">Selecione...</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>

      {taxType === 'IRPJ_CSLL' && (
        <Field label="Periodicidade" required>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setData({ ...data, period_type: 'TRIMESTRAL' })}
              className={`px-3 py-2.5 rounded-sm text-sm border transition ${data.period_type === 'TRIMESTRAL' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
              Trimestral
            </button>
            <button type="button" onClick={() => setData({ ...data, period_type: 'ANUAL_ESTIMATIVA' })}
              className={`px-3 py-2.5 rounded-sm text-sm border transition ${data.period_type === 'ANUAL_ESTIMATIVA' ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
              Mensal (estimativa)
            </button>
          </div>
        </Field>
      )}

      {(taxType === 'IRPJ_CSLL' && data.period_type === 'TRIMESTRAL') ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Trimestre" required>
            <Select value={String(data.quarter)} onChange={e => setData({ ...data, quarter: parseInt(e.target.value) })}>
              {[1, 2, 3, 4].map(q => <option key={q} value={q}>{quarterLabel(q)}</option>)}
            </Select>
          </Field>
          <Field label="Ano" required>
            <Input type="number" value={data.year} onChange={e => setData({ ...data, year: parseInt(e.target.value) })} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Mês" required>
            <Select value={String(data.month)} onChange={e => setData({ ...data, month: parseInt(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')} - {monthNames[m - 1]}</option>)}
            </Select>
          </Field>
          <Field label="Ano" required>
            <Input type="number" value={data.year} onChange={e => setData({ ...data, year: parseInt(e.target.value) })} />
          </Field>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-sm px-4 py-3 text-xs text-blue-800">
        {taxType === 'ALL' && '💡 Calcula os três impostos em sequência usando os parâmetros configurados em Tributário → Configuração tributária da empresa.'}
        {taxType === 'IRPJ_CSLL' && '💡 Consolida receitas (GGR + Contas a Receber pagas) e despesas dedutíveis (Contas a Pagar pagas) do período.'}
        {taxType === 'PIS_COFINS' && '💡 Consolida receitas do mês e (no regime não-cumulativo) créditos de despesas marcadas como geradoras.'}
        {taxType === 'ISS' && '💡 Calcula sobre GGR ou NGR conforme configurado na empresa.'}
      </div>

      {progress && <div className="text-xs text-stone-600">{progress}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !data.company_id}>
          {submitting ? (taxType === 'ALL' ? 'Calculando todos…' : 'Calculando...') : <><Calculator className="w-4 h-4 inline mr-2" /> {taxType === 'ALL' ? 'Calcular todos' : 'Calcular apuração'}</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function TaxApurationsPage() {
  const { user } = useAuth();
  const today = new Date();
  const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
  const currentYear = String(today.getFullYear());

  const [items, setItems] = useState<UnifiedApuration[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({
    year: currentYear,
    month: currentMonth,
  });
  const [modalOpen, setModalOpen] = useState(false);

  const reload = async () => {
    const params: any = {};
    if (filters.tax_type) params.tax_type = filters.tax_type;
    if (filters.year) params.year = filters.year;
    if (filters.month) params.month = filters.month;
    if (filters.status) params.status = filters.status;
    if (filters.company_id) params.company_id = filters.company_id;
    const res = await api.get('/tax/apurations', { params });
    setItems(res.data.data);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => { api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {}); }, []);

  const handleCalculated = async (taxType: TaxChoice, res: any) => {
    setModalOpen(false);
    if (taxType === 'IRPJ_CSLL' && res?.apuration?.id) {
      window.location.href = `/dashboard/tax/apurations/${res.apuration.id}`;
      return;
    }
    await reload();
  };

  const monthOptions = useMemo(() => [
    { value: '', label: 'Todos os meses' },
    ...Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1).padStart(2, '0'),
      label: `${String(i + 1).padStart(2, '0')} · ${monthNames[i]}`,
    })),
  ], []);

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Apurações tributárias"
        subtitle="IRPJ/CSLL · PIS/COFINS · ISS"
        action={
          <button onClick={() => setModalOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <Calculator className="w-4 h-4" /> Calcular apuração
          </button>
        }
      />

      <FilterBar
        filters={[
          ...(user?.profile === 'ADMIN' ? [{
            key: 'company_id', label: 'Empresa', type: 'select' as const,
            options: companies.map(c => ({ value: c.id, label: c.name })),
          }] : []),
          { key: 'tax_type', label: 'Imposto', type: 'select', options: [
            { value: 'IRPJ_CSLL', label: 'IRPJ + CSLL' },
            { value: 'PIS_COFINS', label: 'PIS + COFINS' },
            { value: 'ISS', label: 'ISS' },
          ]},
          { key: 'month', label: 'Mês', type: 'select', options: monthOptions },
          { key: 'year', label: 'Ano' },
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'OPEN', label: 'Aberta' },
            { value: 'CLOSED', label: 'Fechada' },
            { value: 'PAID', label: 'Paga' },
          ]},
        ]}
        values={filters} onChange={setFilters}
      />

      {items.length > 0 && (() => {
        // Totalizadores: separa mensais (PIS/COFINS, ISS, IRPJ mensal estimativa)
        // de trimestrais (IRPJ Lucro Real trimestral). Lista os trimestres distintos.
        const sumOf = (filter: (a: UnifiedApuration) => boolean) =>
          items.filter(filter).reduce((s, a) => s + BigInt(a.tax_amount), 0n);

        const monthlyTotal = sumOf(a => a.period_type !== 'TRIMESTRAL');
        const trimestralItems = items.filter(a => a.period_type === 'TRIMESTRAL');
        const trimestralTotal = trimestralItems.reduce((s, a) => s + BigInt(a.tax_amount), 0n);
        const grandTotal = monthlyTotal + trimestralTotal;
        const trimestralLabels = Array.from(new Set(trimestralItems.map(a => `${a.quarter}T/${a.year}`)));
        const monthLabel = filters.month ? `${filters.month}/${filters.year || ''}` : (filters.year || 'Período');

        return (
          <div className="grid sm:grid-cols-3 gap-3 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Mensal · {monthLabel}</div>
              <div className="font-display text-2xl text-red-800 font-mono">{formatBRL(monthlyTotal.toString())}</div>
              <div className="text-[10px] text-stone-500 mt-1">PIS + COFINS + ISS (e IRPJ mensal, se houver)</div>
            </div>
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Trimestral {trimestralLabels.length > 0 ? `· ${trimestralLabels.join(', ')}` : ''}</div>
              <div className="font-display text-2xl text-red-800 font-mono">{formatBRL(trimestralTotal.toString())}</div>
              <div className="text-[10px] text-stone-500 mt-1">IRPJ + CSLL — pago no mês seguinte ao fim do trimestre</div>
            </div>
            <div className="bg-ink text-stone-100 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-300 mb-1">Total geral (período filtrado)</div>
              <div className="font-display text-2xl text-gold font-mono">{formatBRL(grandTotal.toString())}</div>
              <div className="text-[10px] text-stone-400 mt-1">Soma das apurações exibidas na lista</div>
            </div>
          </div>
        );
      })()}

      {items.length === 0 && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Calculator className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhuma apuração no período</h3>
          <p className="text-stone-600 mb-6">Calcule uma nova apuração para começar.</p>
          <button onClick={() => setModalOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <Calculator className="w-4 h-4" /> Calcular apuração
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Imposto</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Período</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Empresa</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Base</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-red-700">Tributo</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map(a => {
                  const StatusIcon = statusIcons[a.status];
                  return (
                    <tr key={`${a.tax_type}-${a.id}`} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${taxColors[a.tax_type]}`}>
                          {taxLabels[a.tax_type]}
                        </span>
                        {a.tax_type === 'ISS' && a.calculation_base && (
                          <span className="ml-2 text-[10px] text-stone-500">base {a.calculation_base}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-stone-400" />
                          <span className="font-mono">{formatPeriod(a)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs">{a.company?.name || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatBRL(a.base_amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-800 font-medium">{formatBRL(a.tax_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${irpjStatusColors[a.status]}`}>
                          <StatusIcon className="w-3 h-3" />
                          {irpjStatusLabels[a.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.tax_type === 'IRPJ_CSLL' ? (
                          <Link href={`/dashboard/tax/apurations/${a.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-ink bg-stone-100 hover:bg-stone-200 rounded-sm transition">
                            <Eye className="w-3.5 h-3.5" /> Ver
                          </Link>
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Calcular apuração tributária" size="md">
        <CalculateModal companies={companies} current={user} onCalculated={handleCalculated} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  );
}
