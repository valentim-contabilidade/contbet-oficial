'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Eye, Calendar, Download, ArrowDownCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { FiscalDocument } from '@/lib/fiscal-types';
import { fiscalDocumentTypeLabels, fiscalStatusLabels, fiscalStatusColors } from '@/lib/fiscal-format';
import { formatBRL, formatDate, formatDocument } from '@/lib/format';
import { PageHeader, Pagination, FilterBar, DateRangePresets } from '@/components/ui';

export default function MyDocumentsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<FiscalDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({ confirmed: 'confirmed' });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const reload = async () => {
    const res = await api.get('/fiscal/my-documents', { params: { ...filters, page } });
    setItems(res.data.data);
    setTotal(res.data.total);
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [filters, page]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await api.get('/fiscal/documents-export', { params: filters, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minhas-notas-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao exportar.');
    } finally { setExporting(false); }
  };

  if (!user) return null;
  if (user.profile !== 'OWNER' && user.profile !== 'ADMIN' && user.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Minhas notas"
        subtitle="Notas fiscais reivindicadas pelas suas marcas"
        action={
          <button onClick={exportXlsx} disabled={exporting || total === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-stone-100 text-ink text-sm rounded-sm hover:bg-stone-200 transition disabled:opacity-50">
            <Download className="w-4 h-4" /> {exporting ? 'Exportando…' : 'Exportar Excel'}
          </button>
        }
      />

      <Link href="/dashboard/fiscal/claim"
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-sm hover:bg-blue-700 transition mb-4">
        <ArrowDownCircle className="w-4 h-4" /> Reivindicar nova nota
      </Link>

      <DateRangePresets values={filters} onChange={setFilters} />

      <FilterBar
        filters={[
          { key: 'document_type', label: 'Tipo', type: 'select', options: [
            { value: 'NFSE', label: 'NFS-e' },
            { value: 'NFE', label: 'NF-e' },
          ]},
          { key: 'q', label: 'Busca livre', placeholder: 'CNPJ, nome, nº ou descrição' },
          { key: 'start_date', label: 'De', type: 'date' },
          { key: 'end_date', label: 'Até', type: 'date' },
        ]}
        values={filters} onChange={setFilters}
      />

      {items.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhuma nota reivindicada ainda</h3>
          <p className="text-stone-600 mb-4">Quando uma NF chegar para você, reivindique informando número, CNPJ e valor.</p>
          <Link href="/dashboard/fiscal/claim"
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90">
            <ArrowDownCircle className="w-4 h-4" /> Reivindicar primeira nota
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Tipo</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Nº / Emissão</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Emitente</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Valor</th>
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3"><div className="font-medium">{fiscalDocumentTypeLabels[d.document_type]}</div></td>
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
                    {d.confirmed_at && (
                      <div className="text-xs text-green-700 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Conta a pagar criada
                      </div>
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
      )}

      <Pagination page={page} setPage={setPage} total={total} />
    </div>
  );
}
