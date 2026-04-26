'use client';

import { useEffect, useState } from 'react';
import { Layers, Plus, Edit2, Trash2, Sparkles, AlertTriangle, Building2, ArrowDownCircle, ArrowUpCircle, Power, PowerOff, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import type { FinancialNature, NatureType, DreSection } from '@/lib/nature-types';
import {
  natureTypeLabels, dreSectionLabels, dreSectionColors, dreSectionOrder,
  RECEITA_SECTIONS, DESPESA_SECTIONS,
} from '@/lib/nature-format';
import { PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton, NewButton, Modal, ConfirmDeleteModal } from '@/components/ui';

function NatureForm({ initial, current, companies, onSubmit, onCancel }: {
  initial?: Partial<FinancialNature>;
  current: any;
  companies: Company[];
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = !!initial?.id;
  const [data, setData] = useState({
    name: initial?.name ?? '',
    type: initial?.type ?? 'DESPESA' as NatureType,
    dre_section: initial?.dre_section ?? 'DESPESA_OPERACIONAL' as DreSection,
    dre_order: initial?.dre_order ?? 0,
    description: initial?.description ?? '',
    accounting_code: initial?.accounting_code ?? '',
    is_active: initial?.is_active ?? true,
    company_id: initial?.company_id ?? (current.profile === 'MANAGER' ? current.company_id : ''),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Garante que dre_section seja coerente com type
  const handleTypeChange = (newType: NatureType) => {
    const validSections = newType === 'RECEITA' ? RECEITA_SECTIONS : DESPESA_SECTIONS;
    const newSection = validSections.includes(data.dre_section)
      ? data.dre_section
      : validSections[0];
    setData({ ...data, type: newType, dre_section: newSection });
  };

  const validSections = data.type === 'RECEITA' ? RECEITA_SECTIONS : DESPESA_SECTIONS;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!data.name.trim() || data.name.length < 2) errs.name = 'Nome obrigatório';
    if (!isEdit && !data.company_id) errs.company_id = 'Empresa obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        const payload: any = {
          name: data.name,
          type: data.type,
          dre_section: data.dre_section,
          dre_order: data.dre_order,
          is_active: data.is_active,
        };
        if (data.description) payload.description = data.description;
        if (data.accounting_code) payload.accounting_code = data.accounting_code;
        if (!isEdit) payload.company_id = data.company_id;
        await onSubmit(payload);
      } catch (err: any) {
        setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' });
      } finally { setSubmitting(false); }
    }
  };

  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;

  return (
    <form onSubmit={submit} className="space-y-4">
      {!isEdit && (
        <Field label="Empresa" required error={errors.company_id}>
          <Select value={data.company_id} onChange={e => setData({ ...data, company_id: e.target.value })} disabled={current.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}

      <Field label="Tipo" required>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => handleTypeChange('RECEITA')}
            className={`px-3 py-2.5 rounded-sm text-sm border transition flex items-center justify-center gap-2 ${data.type === 'RECEITA' ? 'bg-green-50 border-green-300 text-green-900 font-medium' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <ArrowDownCircle className="w-4 h-4" />
            Receita
          </button>
          <button type="button" onClick={() => handleTypeChange('DESPESA')}
            className={`px-3 py-2.5 rounded-sm text-sm border transition flex items-center justify-center gap-2 ${data.type === 'DESPESA' ? 'bg-red-50 border-red-300 text-red-900 font-medium' : 'bg-stone-50 border-stone-300 hover:border-stone-400'}`}>
            <ArrowUpCircle className="w-4 h-4" />
            Despesa
          </button>
        </div>
      </Field>

      <Field label="Nome" required error={errors.name}>
        <Input value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Ex: Despesas com Marketing Digital" />
      </Field>

      <Field label="Seção da DRE" required>
        <Select value={data.dre_section} onChange={e => setData({ ...data, dre_section: e.target.value as DreSection })}>
          {validSections.map(s => <option key={s} value={s}>{dreSectionLabels[s]}</option>)}
        </Select>
        <div className="text-xs text-stone-500 mt-1">Define em qual linha da DRE este lançamento aparecerá.</div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Ordem na DRE">
          <Input type="number" min={0} value={data.dre_order}
            onChange={e => setData({ ...data, dre_order: parseInt(e.target.value) || 0 })} />
          <div className="text-xs text-stone-500 mt-1">Posição dentro da seção (0 = primeiro)</div>
        </Field>
        <Field label="Código Contábil (opcional)">
          <Input value={data.accounting_code} onChange={e => setData({ ...data, accounting_code: e.target.value })}
            placeholder="Ex: 4.2.01" maxLength={20} />
        </Field>
      </div>

      <Field label="Descrição">
        <textarea value={data.description ?? ''} onChange={e => setData({ ...data, description: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]"
          placeholder="Explicação do que entra nesta natureza..." maxLength={2000} />
      </Field>

      <label className="flex items-center gap-3 p-3 border border-stone-200 rounded-sm cursor-pointer hover:bg-stone-50">
        <input type="checkbox" checked={data.is_active} onChange={e => setData({ ...data, is_active: e.target.checked })} />
        <div>
          <div className="text-sm font-medium">Ativa</div>
          <div className="text-xs text-stone-600">Naturezas inativas não aparecem na seleção dos lançamentos.</div>
        </div>
      </label>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar natureza'}</PrimaryButton>
      </div>
    </form>
  );
}

export default function NaturesPage() {
  const { user } = useAuth();
  const [natures, setNatures] = useState<FinancialNature[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | NatureType>('ALL');
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: 'create' | 'edit' | 'delete' | null; data?: FinancialNature }>({ type: null });

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    });
  }, [user]);

  const reload = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params: any = { company_id: companyId };
      if (filterType !== 'ALL') params.type = filterType;
      const res = await api.get('/financial/natures', { params });
      setNatures(res.data.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId, filterType]);

  const handleSave = async (data: any) => {
    if (modal.data?.id) await api.patch(`/financial/natures/${modal.data.id}`, data);
    else await api.post('/financial/natures', data);
    setModal({ type: null });
    await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/financial/natures/${modal.data.id}`);
    setModal({ type: null });
    await reload();
  };

  const handleToggleActive = async (n: FinancialNature) => {
    await api.patch(`/financial/natures/${n.id}`, { is_active: !n.is_active });
    await reload();
  };

  const handleSeed = async () => {
    if (!companyId) return;
    if (!confirm('Criar as 16 naturezas padrão para esta empresa?\n\nNaturezas que já existirem com o mesmo nome NÃO serão duplicadas.')) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await api.post('/financial/natures/seed-defaults', { company_id: companyId });
      setSeedResult(res.data.message);
      setTimeout(() => setSeedResult(null), 6000);
      await reload();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro ao gerar naturezas padrão.');
    } finally { setSeeding(false); }
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  // Agrupa por seção (na ordem da DRE)
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
    }, {} as Record<string, FinancialNature[]>);

  return (
    <div>
      <PageHeader
        title="Naturezas Contábeis"
        subtitle="Estrutura da DRE: define em qual linha cada lançamento aparece"
        action={<NewButton onClick={() => setModal({ type: 'create' })} label="Nova natureza" />}
      />

      {/* Filtro empresa + tipo + seed */}
      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Empresa</label>
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-stone-500 block mb-1">Tipo</label>
          <div className="flex gap-1">
            {(['ALL', 'RECEITA', 'DESPESA'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`px-3 py-2 rounded-sm text-sm border transition ${filterType === t ? 'bg-ink text-stone-100 border-ink' : 'bg-stone-50 border-stone-300 hover:border-ink'}`}>
                {t === 'ALL' ? 'Todos' : natureTypeLabels[t]}
              </button>
            ))}
          </div>
        </div>
        <button onClick={handleSeed} disabled={seeding || !companyId}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm bg-stone-100 hover:bg-stone-200 rounded-sm transition disabled:opacity-50">
          <Sparkles className="w-4 h-4" /> {seeding ? 'Gerando...' : 'Gerar 16 padrão'}
        </button>
      </div>

      {seedResult && (
        <div className="bg-green-50 border border-green-200 rounded-sm p-4 mb-6 text-sm text-green-900">
          ✓ {seedResult}
        </div>
      )}

      {natures.length === 0 && !loading && companyId && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Layers className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhuma natureza cadastrada</h3>
          <p className="text-stone-600 mb-6">Recomendamos começar com as 16 naturezas padrão para casas de apostas. Você pode editar/desativar depois.</p>
          <button onClick={handleSeed} disabled={seeding}
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <Sparkles className="w-4 h-4" /> Gerar 16 naturezas padrão
          </button>
        </div>
      )}

      {Object.keys(grouped).length > 0 && (
        <div className="space-y-6">
          {Object.entries(grouped).map(([section, items]) => (
            <div key={section} className="bg-white border border-stone-200 rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${dreSectionColors[section as DreSection]}`}>
                    DRE → {dreSectionLabels[section as DreSection]}
                  </span>
                  <span className="text-xs text-stone-500">{items.length} {items.length === 1 ? 'natureza' : 'naturezas'}</span>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-stone-50/50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600 w-12">#</th>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600">Nome</th>
                    <th className="text-left px-4 py-2 text-xs uppercase tracking-wider text-stone-600 w-24">Cód. Contábil</th>
                    <th className="text-center px-4 py-2 text-xs uppercase tracking-wider text-stone-600 w-20">Padrão</th>
                    <th className="text-center px-4 py-2 text-xs uppercase tracking-wider text-stone-600 w-20">Ativa</th>
                    <th className="text-right px-4 py-2 text-xs uppercase tracking-wider text-stone-600 w-32">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(n => (
                    <tr key={n.id} className={`border-b border-stone-100 hover:bg-stone-50 ${!n.is_active ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-500">{n.dre_order}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{n.name}</div>
                        {n.description && <div className="text-xs text-stone-500 mt-0.5 line-clamp-1">{n.description}</div>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-600">{n.accounting_code || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {n.is_default && (
                          <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-sm" title="Natureza padrão do sistema">
                            ★ Padrão
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button onClick={() => handleToggleActive(n)}
                          className={`p-1.5 rounded-sm transition ${n.is_active ? 'text-green-600 hover:bg-green-50' : 'text-stone-400 hover:bg-stone-100'}`}
                          title={n.is_active ? 'Clique para desativar' : 'Clique para ativar'}>
                          {n.is_active ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => setModal({ type: 'edit', data: n })}
                          className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => setModal({ type: 'delete', data: n })}
                          className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal.type === 'create' || modal.type === 'edit'} onClose={() => setModal({ type: null })}
        title={modal.type === 'create' ? 'Nova natureza contábil' : 'Editar natureza'} size="lg">
        {user && <NatureForm initial={modal.data} current={user} companies={companies}
          onSubmit={handleSave} onCancel={() => setModal({ type: null })} />}
      </Modal>

      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })}
        onConfirm={handleDelete}
        entityName={modal.data?.name}
        entityLabel="a natureza" />
    </div>
  );
}
