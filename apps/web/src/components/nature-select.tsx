'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import type { FinancialNature, NatureType, DreSection } from '@/lib/nature-types';
import {
  dreSectionLabels,
  dreSectionColors,
  dreSectionOrder,
  RECEITA_SECTIONS,
  DESPESA_SECTIONS,
} from '@/lib/nature-format';
import { Modal, Field, Input, Select, PrimaryButton, SecondaryButton } from '@/components/ui';

interface NatureSelectProps {
  companyId: string;
  type: NatureType;
  value: string | null;
  onChange: (natureId: string | null, nature: FinancialNature | null) => void;
  required?: boolean;
  disabled?: boolean;
}

const CREATE_VALUE = '__create__';

function QuickNatureForm({ defaultName, type, companyId, onCreated, onCancel }: {
  defaultName: string;
  type: NatureType;
  companyId: string;
  onCreated: (n: FinancialNature) => void;
  onCancel: () => void;
}) {
  const sections = type === 'RECEITA' ? RECEITA_SECTIONS : DESPESA_SECTIONS;
  const [data, setData] = useState({
    name: defaultName,
    dre_section: sections[0] as DreSection,
    accounting_code: '',
    description: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          name: data.name.trim(),
          type,
          dre_section: data.dre_section,
          company_id: companyId,
        };
        if (data.accounting_code) payload.accounting_code = data.accounting_code;
        if (data.description) payload.description = data.description;
        const res = await api.post('/financial/natures', payload);
        onCreated(res.data);
      } catch (err: any) {
        setErrors({ form: err.response?.data?.message ?? 'Erro ao criar.' });
      } finally { setSubmitting(false); }
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-xs text-blue-800">
        💡 Cadastro rápido. Você pode editar mais detalhes depois em <strong>Naturezas (DRE)</strong>.
      </div>

      <Field label="Nome" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} autoFocus
          placeholder={type === 'RECEITA' ? 'Ex: Receita de Apostas' : 'Ex: Aluguel de Sede'} />
      </Field>

      <Field label="Seção DRE" required>
        <Select value={data.dre_section} onChange={e => setData({ ...data, dre_section: e.target.value as DreSection })}>
          {sections.map(s => <option key={s} value={s}>{dreSectionLabels[s]}</option>)}
        </Select>
      </Field>

      <Field label="Código contábil (opcional)">
        <Input value={data.accounting_code} onChange={e => setData({ ...data, accounting_code: e.target.value })}
          placeholder="Ex: 4.1.01.001" />
      </Field>

      <Field label="Descrição (opcional)">
        <textarea value={data.description} onChange={e => setData({ ...data, description: e.target.value })}
          className="w-full px-3 py-2 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Criando...' : <><Plus className="w-4 h-4 inline mr-1.5" /> Cadastrar natureza</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

export function NatureSelect({ companyId, type, value, onChange, required, disabled }: NatureSelectProps) {
  const [natures, setNatures] = useState<FinancialNature[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const reload = () => {
    if (!companyId) {
      setNatures([]);
      return;
    }
    setLoading(true);
    api.get('/financial/natures', {
      params: { company_id: companyId, type, is_active: 'true' },
    })
      .then(r => setNatures(r.data.data))
      .catch(() => setNatures([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line
  }, [companyId, type]);

  useEffect(() => {
    if (value && natures.length > 0) {
      const stillValid = natures.some(n => n.id === value);
      if (!stillValid) onChange(null, null);
    }
    // eslint-disable-next-line
  }, [type, natures]);

  const handleChange = (newId: string) => {
    if (newId === CREATE_VALUE) {
      setCreateOpen(true);
      return;
    }
    if (!newId) { onChange(null, null); return; }
    const selected = natures.find(n => n.id === newId) || null;
    onChange(newId, selected);
  };

  const handleCreated = (n: FinancialNature) => {
    setCreateOpen(false);
    setNatures(prev => [...prev, n]);
    onChange(n.id, n);
  };

  const grouped = natures
    .slice()
    .sort((a, b) => {
      const orderDiff = dreSectionOrder[a.dre_section] - dreSectionOrder[b.dre_section];
      if (orderDiff !== 0) return orderDiff;
      return a.dre_order - b.dre_order;
    })
    .reduce((acc, n) => {
      if (!acc[n.dre_section]) acc[n.dre_section] = [];
      acc[n.dre_section].push(n);
      return acc;
    }, {} as Record<DreSection, FinancialNature[]>);

  const selectedNature = natures.find(n => n.id === value);

  if (!companyId) {
    return <div className="text-xs text-stone-500 px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-sm">Selecione a empresa primeiro</div>;
  }

  if (loading) {
    return <div className="text-xs text-stone-500 px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-sm">Carregando...</div>;
  }

  return (
    <div>
      <select
        value={value ?? ''}
        onChange={e => handleChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm"
      >
        <option value="">— Selecione{required ? '' : ' (opcional)'} —</option>
        {Object.entries(grouped).map(([section, items]) => (
          <optgroup key={section} label={dreSectionLabels[section as DreSection]}>
            {items.map(n => (
              <option key={n.id} value={n.id}>
                {n.name}{n.accounting_code ? ` [${n.accounting_code}]` : ''}
              </option>
            ))}
          </optgroup>
        ))}
        <option disabled>──────────</option>
        <option value={CREATE_VALUE}>＋ Cadastrar nova natureza…</option>
      </select>

      {selectedNature && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${dreSectionColors[selectedNature.dre_section]}`}>
            {dreSectionLabels[selectedNature.dre_section]}
          </span>
          {selectedNature.accounting_code && (
            <span className="text-[10px] text-stone-500 font-mono">{selectedNature.accounting_code}</span>
          )}
        </div>
      )}

      {natures.length === 0 && (
        <div className="text-xs text-amber-700 mt-1.5">
          Sem naturezas de {type === 'RECEITA' ? 'receita' : 'despesa'}. Clique em <strong>＋ Cadastrar nova natureza</strong> acima.
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova natureza contábil" size="md">
        <QuickNatureForm defaultName="" type={type} companyId={companyId}
          onCreated={handleCreated} onCancel={() => setCreateOpen(false)} />
      </Modal>
    </div>
  );
}
