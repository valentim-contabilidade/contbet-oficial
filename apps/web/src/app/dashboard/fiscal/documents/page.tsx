'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FileText, RefreshCw, Eye, Calendar, Building2, ArrowDownCircle, ArrowUpCircle, AlertTriangle, Link2, Unlink, Clock, CheckCircle2, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import type { FiscalDocument, FiscalSyncLog, SyncResult } from '@/lib/fiscal-types';
import { fiscalDocumentTypeLabels, fiscalDirectionLabels, fiscalStatusLabels, fiscalStatusColors } from '@/lib/fiscal-format';
import { formatBRL, formatDate, formatDocument, todayInput } from '@/lib/format';
import { PageHeader, FilterBar, Pagination, Modal, Field, Input, Select, PrimaryButton, SecondaryButton, DateRangePresets } from '@/components/ui';

function SyncModal({ companyId, onSynced, onCancel }: { companyId: string; onSynced: (result: SyncResult) => void; onCancel: () => void }) {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 30);
  const [start, setStart] = useState(monthAgo.toISOString().split('T')[0]);
  const [end, setEnd] = useState(today.toISOString().split('T')[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(''); setSubmitting(true);
    try {
      const res = await api.post('/fiscal/sync', {
        company_id: companyId,
        start_date: start,
        end_date: end,
      });
      onSynced(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao sincronizar');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 text-xs text-blue-800">
        💡 O sistema vai consultar o provedor fiscal configurado e buscar todas as NFSe <strong>recebidas</strong> pela empresa no período. Pode levar alguns segundos dependendo do volume.
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="De" required>
          <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
        </Field>
        <Field label="Até" required>
          <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
        </Field>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 text-xs text-amber-800 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <strong>Limite das prefeituras:</strong> a janela de notas retroativas geralmente é de até 90 dias. Notas mais antigas podem não retornar.
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel} disabled={submitting}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Sincronizando...' : <><RefreshCw className="w-4 h-4 inline mr-2" /> Sincronizar agora</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function FiscalDocumentsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allBrands, setAllBrands] = useState<Array<{ id: string; name: string; company_id: string }>>([]);
  const [items, setItems] = useState<FiscalDocument[]>([]);
  const [logs, setLogs] = useState<FiscalSyncLog[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{
    total_count: number;
    total_amount: number | string;
    breakdown: Array<{ document_type: string; direction: string; count: number; total_amount: number | string }>;
    confirmed_by_direction: Record<string, number>;
  } | null>(null);
  // Filtros iniciais vêm da URL — permite atalhos no menu (ex.: ?document_type=NFSE&direction=INCOMING)
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    ['document_type', 'direction', 'status', 'matched', 'confirmed', 'company_id', 'brand_id', 'q', 'start_date', 'end_date'].forEach(k => {
      const v = searchParams?.get(k);
      if (v) init[k] = v;
    });
    return init;
  });
  const [page, setPage] = useState(1);
  const [syncOpen, setSyncOpen] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const companyId = filters.company_id || (user?.profile === 'MANAGER' ? user.company_id : '');

  useEffect(() => {
    api.get('/companies').then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setFilters(f => ({ ...f, company_id: user.company_id! }));
    });
    api.get('/brands', { params: { page: 1 } }).then(r => setAllBrands(r.data.data || []));
  }, [user]);

  // Filtra marcas pra mostrar só as da empresa selecionada (se houver)
  const brandsFiltered = filters.company_id
    ? allBrands.filter(b => b.company_id === filters.company_id)
    : allBrands;

  // Atualiza filtros se a URL mudar (navegação entre atalhos do sidebar)
  useEffect(() => {
    const fromUrl: Record<string, string> = {};
    ['document_type', 'direction', 'status', 'matched', 'confirmed', 'company_id', 'brand_id', 'q', 'start_date', 'end_date'].forEach(k => {
      const v = searchParams?.get(k);
      if (v) fromUrl[k] = v;
    });
    // Preserva company_id do MANAGER quando navegando entre atalhos
    const preserved: Record<string, string> = user?.profile === 'MANAGER' && user.company_id
      ? { company_id: user.company_id }
      : {};
    setFilters({ ...preserved, ...fromUrl });
    setPage(1);
  }, [searchParams, user]);

  const reload = async () => {
    const [list, statsRes] = await Promise.all([
      api.get('/fiscal/documents', { params: { ...filters, page } }),
      api.get('/fiscal/documents-stats', { params: filters }),
    ]);
    setItems(list.data.data);
    setTotal(list.data.total);
    setStats(statsRes.data);
  };

  const reloadLogs = async () => {
    if (!companyId) return;
    try {
      const res = await api.get(`/fiscal/sync-logs/${companyId}`);
      setLogs(res.data.data);
    } catch {}
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);
  useEffect(() => { reloadLogs(); /* eslint-disable-next-line */ }, [companyId]);

  const handleSynced = async (result: SyncResult) => {
    setSyncOpen(false);
    setLastSync(result);
    setTimeout(() => setLastSync(null), 8000);
    await reload();
    await reloadLogs();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const lastLog = logs[0];

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get('/fiscal/documents-export', {
        params: filters,
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().split('T')[0];
      a.download = `notas-fiscais-${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao exportar planilha.');
    } finally { setExporting(false); }
  };

  return (
    <div>
      <PageHeader
        title="Documentos fiscais"
        subtitle="NFSe e NFe sincronizadas via provedor fiscal"
        action={
          <div className="flex gap-2">
            <button onClick={handleExport} disabled={!companyId || exporting || total === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-stone-100 text-ink text-sm rounded-sm hover:bg-stone-200 transition disabled:opacity-50"
              title="Exporta as notas com os filtros atuais">
              <Download className="w-4 h-4" /> {exporting ? 'Exportando…' : 'Exportar Excel'}
            </button>
            <button onClick={() => setSyncOpen(true)} disabled={!companyId}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition disabled:opacity-50">
              <RefreshCw className="w-4 h-4" /> Sincronizar agora
            </button>
          </div>
        }
      />

      {/* Resultado da última sincronização (toast persistente por 8s) */}
      {lastSync && (
        <div className="bg-green-50 border border-green-300 rounded-sm p-4 mb-6 flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-700 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-green-900 mb-1">Sincronização concluída</h3>
            <p className="text-sm text-green-800">{lastSync.message}</p>
          </div>
        </div>
      )}

      {/* Card de status da última sincronização */}
      {lastLog && !lastSync && (
        <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6 flex items-start gap-3">
          <Clock className="w-5 h-5 text-stone-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-stone-700">
            <strong>Última sincronização:</strong> {new Date(lastLog.created_at).toLocaleString('pt-BR')} {' · '}
            {lastLog.documents_fetched} {lastLog.documents_fetched === 1 ? 'nota encontrada' : 'notas encontradas'}
            {lastLog.documents_created > 0 && <> · <strong>{lastLog.documents_created} novas</strong></>}
            {lastLog.error_message && (
              <div className="text-xs text-red-700 mt-1">⚠️ Erro: {lastLog.error_message}</div>
            )}
          </div>
        </div>
      )}

      {stats && stats.total_count > 0 && (() => {
        const find = (t: string, d: string) =>
          stats.breakdown.find(b => b.document_type === t && b.direction === d);
        const sumDir = (d: string) => stats.breakdown.filter(b => b.direction === d).reduce((s, b) => s + Number(b.total_amount), 0);
        const cntDir = (d: string) => stats.breakdown.filter(b => b.direction === d).reduce((s, b) => s + b.count, 0);
        const incoming = cntDir('INCOMING');
        const outgoing = cntDir('OUTGOING');
        const nfseIn = find('NFSE', 'INCOMING');
        const nfeIn = find('NFE', 'INCOMING');
        const nfseOut = find('NFSE', 'OUTGOING');
        const confIn = stats.confirmed_by_direction['INCOMING'] ?? 0;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Total de notas</div>
              <div className="font-display text-2xl">{stats.total_count}</div>
              <div className="text-xs text-stone-500 mt-1 font-mono">{formatBRL(stats.total_amount)}</div>
            </div>
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
                <ArrowDownCircle className="w-3.5 h-3.5 text-green-600" /> Entradas
              </div>
              <div className="font-display text-2xl">{incoming}</div>
              <div className="text-xs text-stone-500 mt-1 font-mono">{formatBRL(sumDir('INCOMING'))}</div>
              <div className="text-xs text-stone-500 mt-0.5">
                NFSe: {nfseIn?.count ?? 0} · NFe: {nfeIn?.count ?? 0}
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
                <ArrowUpCircle className="w-3.5 h-3.5 text-blue-600" /> Saídas
              </div>
              <div className="font-display text-2xl">{outgoing}</div>
              <div className="text-xs text-stone-500 mt-1 font-mono">{formatBRL(sumDir('OUTGOING'))}</div>
              <div className="text-xs text-stone-500 mt-0.5">
                NFSe: {nfseOut?.count ?? 0}
              </div>
            </div>
            <div className="bg-white border border-stone-200 rounded-sm p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Confirmadas (entradas)
              </div>
              <div className="font-display text-2xl">{confIn}</div>
              <div className="text-xs text-stone-500 mt-1">
                {incoming > 0 ? `${Math.round((confIn / incoming) * 100)}% do total · ${incoming - confIn} pendentes` : '—'}
              </div>
            </div>
          </div>
        );
      })()}

      <DateRangePresets values={filters} onChange={setFilters} />

      <FilterBar
        filters={[
          { key: 'company_id', label: 'Empresa', type: 'select', options: companies.map(c => ({ value: c.id, label: c.name })) },
          { key: 'document_type', label: 'Tipo', type: 'select', options: [
            { value: 'NFSE', label: 'NFS-e' },
            { value: 'NFE', label: 'NF-e' },
          ]},
          { key: 'direction', label: 'Direção', type: 'select', options: [
            { value: 'INCOMING', label: 'Entrada' },
            { value: 'OUTGOING', label: 'Saída' },
          ]},
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: 'AUTHORIZED', label: 'Autorizada' },
            { value: 'CANCELLED', label: 'Cancelada' },
            { value: 'REJECTED', label: 'Rejeitada' },
          ]},
          { key: 'confirmed', label: 'Confirmação', type: 'select', options: [
            { value: 'pending', label: 'Aguardando' },
            { value: 'confirmed', label: 'Confirmadas' },
          ]},
          { key: 'matched', label: 'Vinculação', type: 'select', options: [
            { value: 'true', label: 'Vinculadas' },
            { value: 'false', label: 'Não vinculadas' },
          ]},
          { key: 'brand_id', label: 'Marca', type: 'select', options: [
            { value: 'NONE', label: 'Sem marca' },
            ...brandsFiltered.map(b => ({ value: b.id, label: b.name })),
          ]},
          { key: 'q', label: 'Busca livre', placeholder: 'CNPJ, nome, nº ou descrição' },
          { key: 'start_date', label: 'De', type: 'date' },
          { key: 'end_date', label: 'Até', type: 'date' },
        ]}
        values={filters} onChange={setFilters}
      />

      {items.length === 0 && !filters.company_id && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Selecione uma empresa</h3>
          <p className="text-stone-600">Escolha uma empresa nos filtros acima para ver as notas fiscais.</p>
        </div>
      )}

      {items.length === 0 && filters.company_id && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhum documento encontrado</h3>
          <p className="text-stone-600 mb-6">Clique em "Sincronizar agora" para buscar as notas fiscais no provedor configurado.</p>
          <button onClick={() => setSyncOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <RefreshCw className="w-4 h-4" /> Sincronizar agora
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nº / Emissão</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Emitente</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Valor</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                  <th className="text-center px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Vínculo</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr key={d.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {d.direction === 'INCOMING' ?
                          <ArrowDownCircle className="w-4 h-4 text-green-600" strokeWidth={1.5} /> :
                          <ArrowUpCircle className="w-4 h-4 text-blue-600" strokeWidth={1.5} />
                        }
                        <div>
                          <div className="font-medium">{fiscalDocumentTypeLabels[d.document_type]}</div>
                          <div className="text-xs text-stone-500">{fiscalDirectionLabels[d.direction]}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">{d.document_number || '—'}{d.series ? `/${d.series}` : ''}</div>
                      <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                        <Calendar className="w-3 h-3" /> {formatDate(d.issue_date)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-xs">{d.issuer_name}</div>
                      <div className="text-xs text-stone-500 font-mono">{formatDocument(d.issuer_cnpj)}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatBRL(d.total_amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${fiscalStatusColors[d.status]}`}>
                        {fiscalStatusLabels[d.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {d.matched_payable_id || d.matched_receivable_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700" title="Vinculada">
                          <Link2 className="w-3.5 h-3.5" /> Vinculada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-stone-400" title="Não vinculada">
                          <Unlink className="w-3.5 h-3.5" /> —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/fiscal/documents/${d.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-ink bg-stone-100 hover:bg-stone-200 rounded-sm transition">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} setPage={setPage} total={total} />

      <Modal open={syncOpen} onClose={() => setSyncOpen(false)} title="Sincronizar notas fiscais" size="md">
        {companyId && <SyncModal companyId={companyId} onSynced={handleSynced} onCancel={() => setSyncOpen(false)} />}
      </Modal>
    </div>
  );
}
