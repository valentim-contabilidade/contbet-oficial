'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Calendar, Building2, Receipt, ExternalLink, Code, Link2, ArrowDownCircle, ArrowUpCircle, FileCode, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { FiscalDocument } from '@/lib/fiscal-types';
import { fiscalDocumentTypeLabels, fiscalDirectionLabels, fiscalStatusLabels, fiscalStatusColors } from '@/lib/fiscal-format';
import { formatBRL, formatDate, formatDocument } from '@/lib/format';

export default function FiscalDocumentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [doc, setDoc] = useState<FiscalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [showXml, setShowXml] = useState(false);

  useEffect(() => {
    api.get(`/fiscal/documents/${id}`)
      .then(r => setDoc(r.data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-center text-stone-500 py-20">Carregando documento...</div>;
  if (!doc) return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Documento não encontrado.</div>;

  return (
    <div>
      <Link href="/dashboard/fiscal/documents" className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar para listagem
      </Link>

      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-3 rounded-sm ${doc.direction === 'INCOMING' ? 'bg-green-50' : 'bg-blue-50'}`}>
              {doc.direction === 'INCOMING' ?
                <ArrowDownCircle className="w-6 h-6 text-green-700" strokeWidth={1.5} /> :
                <ArrowUpCircle className="w-6 h-6 text-blue-700" strokeWidth={1.5} />
              }
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">
                {fiscalDocumentTypeLabels[doc.document_type]} · {fiscalDirectionLabels[doc.direction]}
              </div>
              <h1 className="font-display text-3xl mb-1">Nº {doc.document_number || '—'}{doc.series ? `/${doc.series}` : ''}</h1>
              <div className="text-sm text-stone-600 flex items-center gap-3">
                <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(doc.issue_date)}</span>
                {doc.access_key && (
                  <span className="font-mono text-xs text-stone-500" title="Chave de acesso">🔑 {doc.access_key}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs px-3 py-1.5 rounded-sm uppercase tracking-wider ${fiscalStatusColors[doc.status]}`}>
              {fiscalStatusLabels[doc.status]}
            </span>
            {doc.pdf_url && (
              <a href={doc.pdf_url} target="_blank" rel="noopener"
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-sm rounded-sm transition">
                <ExternalLink className="w-3.5 h-3.5" /> Baixar PDF
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Vinculação */}
      {(doc.matched_payable || doc.matched_receivable) ? (
        <div className="bg-green-50 border border-green-200 rounded-sm p-4 mb-6">
          <div className="flex items-start gap-3">
            <Link2 className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-green-900 mb-1">Documento vinculado</h3>
              {doc.matched_payable && (
                <div className="text-sm text-green-800">
                  Conta a pagar: <strong>{doc.matched_payable.description}</strong> · {formatBRL(doc.matched_payable.amount)}
                  <Link href={`/dashboard/financial/accounts-payable`} className="ml-2 underline">ver</Link>
                </div>
              )}
              {doc.matched_receivable && (
                <div className="text-sm text-green-800">
                  Conta a receber: <strong>{doc.matched_receivable.description}</strong> · {formatBRL(doc.matched_receivable.amount)}
                  <Link href={`/dashboard/financial/accounts-receivable`} className="ml-2 underline">ver</Link>
                </div>
              )}
              {doc.match_score && (
                <div className="text-xs text-green-700 mt-1">Confiança do matching: {doc.match_score}%</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-amber-900 mb-1">Ainda não vinculada</h3>
            <p className="text-sm text-amber-800">
              Esta nota fiscal não está vinculada a nenhuma conta a pagar/receber. A vinculação automática será disponibilizada na próxima atualização do sistema.
            </p>
          </div>
        </div>
      )}

      {/* 2 colunas: Emitente e Destinatário */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-stone-200 rounded-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-stone-400" />
            <h2 className="text-xs uppercase tracking-wider text-stone-700 font-medium">Emitente / Prestador</h2>
          </div>
          <div className="font-medium text-lg mb-1">{doc.issuer_name}</div>
          <div className="text-sm text-stone-600 font-mono">{formatDocument(doc.issuer_cnpj)}</div>
          {doc.issuer_state && <div className="text-xs text-stone-500 mt-1">{doc.issuer_state} · Cód. município: {doc.issuer_municipality_code || '—'}</div>}
        </div>

        <div className="bg-white border border-stone-200 rounded-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-stone-400" />
            <h2 className="text-xs uppercase tracking-wider text-stone-700 font-medium">Destinatário / Tomador</h2>
          </div>
          <div className="font-medium text-lg mb-1">{doc.recipient_name || '—'}</div>
          <div className="text-sm text-stone-600 font-mono">{doc.recipient_cnpj ? formatDocument(doc.recipient_cnpj) : '—'}</div>
        </div>
      </div>

      {/* Descrição do serviço */}
      {doc.description && (
        <div className="bg-white border border-stone-200 rounded-sm p-5 mb-6">
          <h2 className="text-xs uppercase tracking-wider text-stone-700 font-medium mb-3">Descrição do serviço</h2>
          <p className="text-sm text-stone-700 whitespace-pre-wrap">{doc.description}</p>
          {(doc.service_code || doc.cnae) && (
            <div className="mt-3 pt-3 border-t border-stone-200 flex flex-wrap gap-4 text-xs text-stone-600">
              {doc.service_code && <span><strong>Código de serviço:</strong> {doc.service_code}</span>}
              {doc.cnae && <span><strong>CNAE:</strong> {doc.cnae}</span>}
            </div>
          )}
        </div>
      )}

      {/* Valores */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Valores</h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="border border-stone-200 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Valor total</div>
            <div className="font-display text-2xl">{formatBRL(doc.total_amount)}</div>
          </div>
          <div className="border border-stone-200 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">Serviços</div>
            <div className="font-display text-xl">{formatBRL(doc.service_amount)}</div>
          </div>
          <div className="border border-blue-200 bg-blue-50/30 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wider text-blue-800 mb-1">ISS {doc.iss_rate ? `(${doc.iss_rate}%)` : ''}</div>
            <div className="font-display text-xl text-blue-900">{formatBRL(doc.iss_amount)}</div>
          </div>
          <div className="border border-purple-200 bg-purple-50/30 rounded-sm p-4">
            <div className="text-xs uppercase tracking-wider text-purple-800 mb-1">IRRF</div>
            <div className="font-display text-xl text-purple-900">{formatBRL(doc.irrf_amount)}</div>
          </div>
        </div>

        {/* Outros impostos se tiverem valor > 0 */}
        {(Number(doc.inss_amount) > 0 || Number(doc.pis_amount) > 0 || Number(doc.cofins_amount) > 0 || Number(doc.csll_amount) > 0) && (
          <div className="grid sm:grid-cols-4 gap-4 pt-4 border-t border-stone-200">
            {Number(doc.inss_amount) > 0 && (
              <div className="text-sm">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">INSS</div>
                <div className="font-mono">{formatBRL(doc.inss_amount)}</div>
              </div>
            )}
            {Number(doc.pis_amount) > 0 && (
              <div className="text-sm">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">PIS</div>
                <div className="font-mono">{formatBRL(doc.pis_amount)}</div>
              </div>
            )}
            {Number(doc.cofins_amount) > 0 && (
              <div className="text-sm">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">COFINS</div>
                <div className="font-mono">{formatBRL(doc.cofins_amount)}</div>
              </div>
            )}
            {Number(doc.csll_amount) > 0 && (
              <div className="text-sm">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">CSLL</div>
                <div className="font-mono">{formatBRL(doc.csll_amount)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* XML */}
      {doc.xml_content && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <button onClick={() => setShowXml(!showXml)}
            className="w-full px-6 py-4 border-b border-stone-200 flex items-center justify-between hover:bg-stone-50 transition">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-stone-500" />
              <h2 className="font-display text-lg">XML do documento</h2>
            </div>
            <span className="text-xs text-stone-500">{showXml ? 'Ocultar' : 'Mostrar'}</span>
          </button>
          {showXml && (
            <div className="p-6 bg-stone-50">
              <pre className="text-xs font-mono text-stone-700 whitespace-pre-wrap break-all max-h-96 overflow-auto bg-white p-4 border border-stone-200 rounded-sm">
                {doc.xml_content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
