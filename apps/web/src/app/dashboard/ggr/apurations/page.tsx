'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calculator, Eye, Calendar, Lock, Unlock, CheckCircle2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, monthNames } from '@/lib/format';
import { PageHeader, FilterBar, Modal, PrimaryButton, SecondaryButton, Field, Select, ConfirmDeleteModal } from '@/components/ui';
import type { GgrMonthlyApuration } from '@/lib/ggr-types';
import type { Brand, Company } from '@/lib/types';

const apurationStatusLabels: Record<string, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  PAID: 'Paga',
};

const apurationStatusColors: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-700 border border-blue-200',
  CLOSED: 'bg-amber-50 text-amber-800 border border-amber-200',
  PAID: 'bg-green-50 text-green-700 border border-green-200',
};

const apurationStatusIcons: Record<string, any> = {
  OPEN: Unlock,
  CLOSED: Lock,
  PAID: CheckCircle2,
};

function GenerateApurationModal({ brands, companies, current, onConfirm, onCancel }: {
  brands: Brand[]; companies: Company[]; current: any;
  onConfirm: (data: any) => Promise<void>; onCancel: () => void;
}) {
  const today = new Date();
  const [data, setData] = useState({
    company_id: current.profile === 'MANAGER' ? current.company_id : '',
    brand_id: '',
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [submitting, setSubmitting] = useState(false);
  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;
  const visibleBrands = data.company_id ? brands.filter(b => b.company_id === data.company_id) : [];

  const submit = async () => {
    if (!data.brand_id) return;
    setSubmitting(true);
    try {
      await onConfirm(data);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <Field label="Empresa" required>
        <Select value={data.company_id} disabled={current.profile === 'MANAGER'}
          onChange={e => setData({ ...data, company_id: e.target.value, brand_id: '' })}>
          <option value="">Selecione...</option>
          {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Marca" required>
        <Select value={data.brand_id} onChange={e => setData({ ...data, brand_id: e.target.value })} disabled={!data.company_id}>
          <option value="">{data.company_id ? 'Selecione...' : 'Selecione a empresa primeiro'}</option>
          {visibleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Mês" required>
          <Select value={String(data.month)} onChange={e => setData({ ...data, month: parseInt(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')} - {monthNames[m - 1]}</option>)}
          </Select>
        </Field>
        <Field label="Ano" required>
          <input type="number" value={data.year} onChange={e => setData({ ...data, year: parseInt(e.target.value) })}
            className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm" />
        </Field>
      </div>
      <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-sm text-xs text-blue-800">
        💡 Esta ação calcula automaticamente o GGR e os impostos para o período selecionado, com base nos registros diários já cadastrados.
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !data.brand_id}>
          {submitting ? 'Calculando...' : 'Ver apuração'}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function ApurationsListPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<GgrMonthlyApuration[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GgrMonthlyApuration | null>(null);

  const reload = async () => {
    const res = await api.get('/ggr/apurations', { params: filters });
    setItems(res.data.data);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters]);
  useEffect(() => {
    api.get('/brands').then(r => setBrands(r.data.data)).catch(() => {});
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
  }, []);

  const visibleBrands = filters.company_id ? brands.filter(b => b.company_id === filters.company_id) : brands;

  const handleGenerate = async (data: any) => {
    // Apenas navega para a tela de detalhe — ela vai calcular automaticamente
    setModalOpen(false);
    window.location.href = `/dashboard/ggr/monthly/${data.brand_id}/${data.year}/${data.month}`;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/ggr/apurations/${deleteTarget.id}`);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao excluir.');
      return;
    } finally {
      setDeleteTarget(null);
    }
    await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Apurações Mensais"
        subtitle="Histórico de fechamentos e impostos calculados"
        action={
          <button onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <Calculator className="w-4 h-4" /> Calcular novo período
          </button>
        }
      />

      <FilterBar
        filters={[
          ...(user?.profile === 'ADMIN' ? [{ key: 'company_id', label: 'Empresa', type: 'select' as const, options: companies.map(c => ({ value: c.id, label: c.name })) }] : []),
          { key: 'brand_id', label: 'Marca', type: 'select', options: visibleBrands.map(b => ({ value: b.id, label: b.name })) },
          { key: 'year', label: 'Ano' },
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'OPEN', label: 'Aberta' },
            { value: 'CLOSED', label: 'Fechada' },
            { value: 'PAID', label: 'Paga' },
          ]},
        ]}
        values={filters} onChange={(v) => {
          if (v.company_id !== filters.company_id) v.brand_id = '';
          setFilters(v);
        }}
      />

      {items.length === 0 && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Calculator className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhuma apuração encontrada</h3>
          <p className="text-stone-600 mb-6">As apurações são criadas automaticamente quando você consulta um período pela primeira vez.</p>
          <button onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <Calculator className="w-4 h-4" /> Calcular primeiro período
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Período</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Marca</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-amber-700">GGR</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-red-700">Total Impostos</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map(a => {
                  const StatusIcon = apurationStatusIcons[a.status];
                  return (
                    <tr key={a.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-stone-400" />
                          <span className="font-mono">{String(a.month).padStart(2, '0')}/{a.year}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-stone-700">{a.brand?.name || '—'}</td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${Number(a.ggr) >= 0 ? 'text-amber-800' : 'text-red-700'}`}>
                        {formatBRL(a.ggr)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-red-800">{formatBRL(a.total_taxes)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${apurationStatusColors[a.status]}`}>
                          <StatusIcon className="w-3 h-3" />
                          {apurationStatusLabels[a.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link href={`/dashboard/ggr/monthly/${a.brand_id}/${a.year}/${a.month}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-ink bg-stone-100 hover:bg-stone-200 rounded-sm transition">
                          <Eye className="w-3.5 h-3.5" /> Ver detalhes
                        </Link>
                        {a.status === 'OPEN' && (
                          <button onClick={() => setDeleteTarget(a)}
                            className="ml-1 p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm" title="Excluir apuração">
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Calcular apuração mensal" size="md">
        <GenerateApurationModal brands={brands} companies={companies} current={user} onConfirm={handleGenerate} onCancel={() => setModalOpen(false)} />
      </Modal>

      <ConfirmDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        entityName={deleteTarget ? `apuração ${String(deleteTarget.month).padStart(2, '0')}/${deleteTarget.year} (${deleteTarget.brand?.name})` : ''}
        entityLabel="a apuração"
      />
    </div>
  );
}
