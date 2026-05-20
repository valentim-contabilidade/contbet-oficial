'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2, Calendar, FileSpreadsheet, Edit2, Database, Hand, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate, monthNames } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, ConfirmDeleteModal, Modal, Field, Input, PrimaryButton, SecondaryButton } from '@/components/ui';
import { CurrencyInput, MoneyText } from '@/components/financial-ui';
import type { GgrDailyRecord } from '@/lib/ggr-types';
import type { Brand, Company } from '@/lib/types';

function EditDailyModal({ record, onSubmit, onCancel }: {
  record: GgrDailyRecord; onSubmit: (data: any) => Promise<void>; onCancel: () => void;
}) {
  const [data, setData] = useState({
    total_bets: Number(record.total_bets ?? 0),
    total_prizes: Number(record.total_prizes ?? 0),
    total_deposits: Number(record.total_deposits ?? 0),
    total_withdrawals: Number(record.total_withdrawals ?? 0),
    total_bonus: Number(record.total_bonus ?? 0),
    bet_count: record.bet_count ?? 0,
    prize_count: record.prize_count ?? 0,
    deposit_count: record.deposit_count ?? 0,
    withdrawal_count: record.withdrawal_count ?? 0,
    active_players: record.active_players ?? 0,
    notes: record.notes ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(data);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao salvar.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3 text-sm">
        <div className="font-medium">{record.brand?.name}</div>
        <div className="text-xs text-stone-600">Data: {formatDate(record.date)}</div>
      </div>
      <div className="bg-amber-50/50 border border-amber-200 rounded-sm p-3">
        <div className="text-[11px] uppercase tracking-wider text-amber-900 font-medium mb-2">Apostas e prêmios</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Apostas (R$)"><CurrencyInput value={data.total_bets} onChange={v => setData({ ...data, total_bets: v })} /></Field>
          <Field label="Prêmios (R$)"><CurrencyInput value={data.total_prizes} onChange={v => setData({ ...data, total_prizes: v })} /></Field>
          <Field label="Qtd. apostas"><Input type="number" min="0" value={data.bet_count} onChange={e => setData({ ...data, bet_count: parseInt(e.target.value) || 0 })} /></Field>
          <Field label="Qtd. prêmios"><Input type="number" min="0" value={data.prize_count} onChange={e => setData({ ...data, prize_count: parseInt(e.target.value) || 0 })} /></Field>
        </div>
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-sm p-3">
        <div className="text-[11px] uppercase tracking-wider text-stone-700 font-medium mb-2">Movimentação de carteira (usado na auditoria de tarifas)</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Depósitos (R$)"><CurrencyInput value={data.total_deposits} onChange={v => setData({ ...data, total_deposits: v })} /></Field>
          <Field label="Saques (R$)"><CurrencyInput value={data.total_withdrawals} onChange={v => setData({ ...data, total_withdrawals: v })} /></Field>
          <Field label="Qtd. depósitos"><Input type="number" min="0" value={data.deposit_count} onChange={e => setData({ ...data, deposit_count: parseInt(e.target.value) || 0 })} /></Field>
          <Field label="Qtd. saques"><Input type="number" min="0" value={data.withdrawal_count} onChange={e => setData({ ...data, withdrawal_count: parseInt(e.target.value) || 0 })} /></Field>
        </div>
      </div>

      <div className="bg-purple-50/40 border border-purple-200 rounded-sm p-3">
        <div className="text-[11px] uppercase tracking-wider text-purple-900 font-medium mb-2">Gamificação</div>
        <Field label="Bônus distribuídos no dia (R$)">
          <CurrencyInput value={data.total_bonus} onChange={v => setData({ ...data, total_bonus: v })} />
        </Field>
        <p className="text-[10px] text-stone-500 mt-1">
          Cashback, freebets, depósitos bonificados, pontos resgatados em apostas. Não compõe o GGR (Lei 14.790), mas é despesa de marketing dedutível em IRPJ/CSLL.
        </p>
      </div>

      <Field label="Jogadores ativos">
        <Input type="number" min="0" value={data.active_players} onChange={e => setData({ ...data, active_players: parseInt(e.target.value) || 0 })} />
      </Field>
      <Field label="Observações">
        <textarea value={data.notes} onChange={e => setData({ ...data, notes: e.target.value })}
          className="w-full px-3 py-2 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}
      <div className="flex justify-end gap-3 pt-3 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar'}</PrimaryButton>
      </div>
    </div>
  );
}

const sourceTypeLabels: Record<string, string> = {
  CSV_UPLOAD: 'CSV',
  XLSX_UPLOAD: 'XLSX',
  API_REST: 'API',
  MANUAL: 'Manual',
};

const sourceTypeIcons: Record<string, any> = {
  CSV_UPLOAD: FileSpreadsheet,
  XLSX_UPLOAD: FileSpreadsheet,
  API_REST: Database,
  MANUAL: Hand,
};

export default function GgrDailyPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<GgrDailyRecord[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<GgrDailyRecord | null>(null);
  const [editTarget, setEditTarget] = useState<GgrDailyRecord | null>(null);

  const reload = async () => {
    const res = await api.get('/ggr/daily', { params: { ...filters, page } });
    setItems(res.data.data);
    setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => {
    api.get('/brands').then(r => setBrands(r.data.data)).catch(() => {});
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
  }, []);

  const visibleBrands = filters.company_id ? brands.filter(b => b.company_id === filters.company_id) : brands;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.delete(`/ggr/daily/${deleteTarget.id}`);
    setDeleteTarget(null);
    await reload();
  };

  const handleEditSave = async (data: any) => {
    if (!editTarget) return;
    await api.patch(`/ggr/daily/${editTarget.id}`, data);
    setEditTarget(null);
    await reload();
  };

  const [issuingId, setIssuingId] = useState<string | null>(null);
  const handleIssueNfse = async (recordId: string) => {
    if (!confirm('Emitir NFSe da receita deste dia? Esta ação não pode ser desfeita.')) return;
    setIssuingId(recordId);
    try {
      const res = await api.post('/fiscal/issue/ggr-daily', { ggr_record_id: recordId });
      const status = res.data.status;
      const numero = res.data.document_number ? `nº ${res.data.document_number}` : '';
      alert(`NFSe ${status === 'AUTHORIZED' ? 'emitida' : status} ${numero}.`);
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Erro ao emitir NFSe.');
    } finally {
      setIssuingId(null);
    }
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Registros diários"
        subtitle="Volume operacional consolidado por dia"
        action={
          <Link href="/dashboard/ggr/import" className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            Importar dados
          </Link>
        }
      />

      <FilterBar
        filters={[
          ...(user?.profile === 'ADMIN' ? [{ key: 'company_id', label: 'Empresa', type: 'select' as const, options: companies.map(c => ({ value: c.id, label: c.name })) }] : []),
          { key: 'brand_id', label: 'Marca', type: 'select', options: visibleBrands.map(b => ({ value: b.id, label: b.name })) },
          { key: 'date_from', label: 'De', placeholder: 'YYYY-MM-DD' },
          { key: 'date_to', label: 'Até', placeholder: 'YYYY-MM-DD' },
        ]}
        values={filters} onChange={(v) => {
          // Se trocou a empresa, reseta a marca
          if (v.company_id !== filters.company_id) v.brand_id = '';
          setFilters(v);
        }}
      />

      <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Data</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Marca</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Apostas</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Prêmios</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-amber-700">GGR</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Depósitos</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Saques</th>
                <th className="text-center px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Origem</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-stone-500">Nenhum registro encontrado.</td></tr>}
              {items.map(r => {
                const SourceIcon = sourceTypeIcons[r.source_type] || FileSpreadsheet;
                return (
                  <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-stone-400" />
                        <span className="font-mono text-xs">{formatDate(r.date)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-700 text-xs">{r.brand?.name || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono"><MoneyText cents={r.total_bets} /></td>
                    <td className="px-4 py-3 text-right font-mono text-red-700">{formatBRL(r.total_prizes)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-medium ${Number(r.ggr) >= 0 ? 'text-green-800' : 'text-red-700'}`}>
                      {formatBRL(r.ggr)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-stone-700">{formatBRL(r.total_deposits)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-stone-700">{formatBRL(r.total_withdrawals)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-xs text-stone-600">
                        <SourceIcon className="w-3.5 h-3.5" />
                        {sourceTypeLabels[r.source_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => handleIssueNfse(r.id)}
                        disabled={issuingId === r.id || Number(r.ggr) <= 0}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-sm transition disabled:opacity-50 disabled:cursor-not-allowed mr-1"
                        title={Number(r.ggr) <= 0 ? 'GGR zero ou negativo' : 'Emitir NFSe da receita do dia'}>
                        <FileText className="w-3.5 h-3.5" />
                        {issuingId === r.id ? 'Emitindo…' : 'Emitir NFSe'}
                      </button>
                      <button onClick={() => setEditTarget(r)}
                        className="p-1.5 text-stone-500 hover:text-ink hover:bg-stone-100 rounded-sm" title="Editar">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(r)}
                        className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1" title="Excluir">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} />

      <ConfirmDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        entityName={deleteTarget ? `registro de ${formatDate(deleteTarget.date)} (${deleteTarget.brand?.name})` : ''}
        entityLabel="o registro"
      />

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Editar registro diário" size="md">
        {editTarget && <EditDailyModal record={editTarget} onSubmit={handleEditSave} onCancel={() => setEditTarget(null)} />}
      </Modal>
    </div>
  );
}
