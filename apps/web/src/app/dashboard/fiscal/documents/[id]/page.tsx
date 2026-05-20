'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Calendar, Building2, Receipt, ExternalLink, Code, Link2, ArrowDownCircle, ArrowUpCircle, FileCode, AlertTriangle, Download, Copy, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react';
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
  const [xmlMode, setXmlMode] = useState<'formatted' | 'raw'>('formatted');
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [savingBrand, setSavingBrand] = useState(false);
  const [events, setEvents] = useState<{ events: any[]; note?: string; error?: string } | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const confirmDoc = async () => {
    if (!doc) return;
    setConfirming(true);
    try {
      const r = await api.post(`/fiscal/documents/${doc.id}/confirm`);
      setDoc(r.data);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao confirmar.');
    } finally { setConfirming(false); }
  };

  const unconfirmDoc = async () => {
    if (!doc) return;
    if (!confirm('Desfazer a confirmação? A conta a pagar criada será removida.')) return;
    setConfirming(true);
    try {
      const r = await api.post(`/fiscal/documents/${doc.id}/unconfirm`);
      setDoc(r.data);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao desfazer.');
    } finally { setConfirming(false); }
  };

  const loadEvents = async () => {
    setEventsLoading(true);
    try {
      const r = await api.get(`/fiscal/documents/${id}/events`);
      setEvents(r.data);
    } catch (err: any) {
      setEvents({ events: [], error: err?.response?.data?.message ?? err.message });
    } finally { setEventsLoading(false); }
  };

  useEffect(() => {
    if (!doc?.company_id) return;
    api.get('/brands', { params: { company_id: doc.company_id, page: 1 } })
      .then(r => setBrands((r.data.data || []).filter((b: any) => b.company_id === doc.company_id)));
  }, [doc?.company_id]);

  const onSelectBrand = async (brandId: string) => {
    if (!doc) return;
    setSavingBrand(true);
    try {
      const r = await api.patch(`/fiscal/documents/${doc.id}`, { brand_id: brandId || null });
      setDoc(r.data);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao salvar marca.');
    } finally { setSavingBrand(false); }
  };

  const downloadXml = async () => {
    try {
      const r = await api.get(`/fiscal/documents/${id}/xml`, { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const docNumber = doc?.document_number ?? id;
      const docType = doc?.document_type === 'NFE' ? 'nfe' : 'nfse';
      a.download = `${docType}_${docNumber}_${doc?.issuer_cnpj || ''}.xml`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Erro ao baixar XML.');
    }
  };

  const copyKey = () => {
    if (doc?.access_key) {
      navigator.clipboard.writeText(doc.access_key);
    }
  };

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

          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-3 py-1.5 rounded-sm uppercase tracking-wider ${fiscalStatusColors[doc.status]}`}>
              {fiscalStatusLabels[doc.status]}
            </span>
            {doc.xml_content && (
              <button onClick={downloadXml}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-sm rounded-sm transition">
                <Download className="w-3.5 h-3.5" /> Baixar XML
              </button>
            )}
            {doc.pdf_url && (
              <a href={doc.pdf_url} target="_blank" rel="noopener"
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-sm rounded-sm transition">
                <ExternalLink className="w-3.5 h-3.5" /> Baixar PDF
              </a>
            )}
            {doc.access_key && (
              <button onClick={copyKey} title="Copiar chave de acesso"
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-sm rounded-sm transition">
                <Copy className="w-3.5 h-3.5" /> Copiar chave
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status de confirmação */}
      {(doc as any).confirmed_at ? (
        <div className="bg-green-50 border border-green-200 rounded-sm p-4 mb-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-green-900 mb-1">Nota confirmada</h3>
              <p className="text-sm text-green-800 mb-2">
                Confirmada em {formatDate((doc as any).confirmed_at)}.
              </p>
              {doc.matched_payable && (
                <div className="text-sm text-green-800">
                  Conta a pagar: <strong>{doc.matched_payable.description}</strong> · {formatBRL(doc.matched_payable.amount)}
                  <Link href={`/dashboard/financial/accounts-payable`} className="ml-2 underline">ver no financeiro</Link>
                </div>
              )}
              {doc.matched_receivable && (
                <div className="text-sm text-green-800">
                  Conta a receber: <strong>{doc.matched_receivable.description}</strong> · {formatBRL(doc.matched_receivable.amount)}
                  <Link href={`/dashboard/financial/accounts-receivable`} className="ml-2 underline">ver</Link>
                </div>
              )}
            </div>
            <button onClick={unconfirmDoc} disabled={confirming}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-green-300 hover:bg-green-100 text-sm rounded-sm transition disabled:opacity-50">
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Desfazer confirmação
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-900 mb-1">Aguardando confirmação</h3>
              <p className="text-sm text-amber-800">
                Selecione a marca operacional abaixo e clique em <strong>Confirmar</strong> para criar a Conta a Pagar correspondente.
              </p>
            </div>
            <button onClick={confirmDoc} disabled={confirming || !(doc as any).brand_id || doc.direction !== 'INCOMING' || doc.status !== 'AUTHORIZED'}
              title={!(doc as any).brand_id ? 'Selecione uma marca primeiro' : 'Confirmar e gerar conta a pagar'}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 hover:bg-ink2 text-sm rounded-sm transition disabled:opacity-50 disabled:cursor-not-allowed">
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* Marca operacional (opcional) */}
      <div className="bg-white border border-stone-200 rounded-sm p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-stone-700 font-medium mb-1">Marca operacional</h3>
            <p className="text-xs text-stone-500">
              Aloca esta nota a uma marca específica desta empresa (ex.: Pixbet → marca BetDaSorte). Opcional.
            </p>
          </div>
          <select
            value={(doc as any).brand_id ?? ''}
            onChange={(e) => onSelectBrand(e.target.value)}
            disabled={savingBrand || brands.length === 0}
            className="px-3 py-2 bg-stone-50 border border-stone-300 text-sm rounded-sm focus:outline-none focus:border-ink min-w-[220px]"
          >
            <option value="">— sem marca —</option>
            {brands.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

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

      {/* Manifestação SEFAZ — só pra NFe */}
      {doc.document_type === 'NFE' && (
        <div className="bg-white border border-stone-200 rounded-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-stone-700 font-medium mb-1">Manifestação do destinatário (SEFAZ)</h3>
              <p className="text-xs text-stone-500">
                Ciência, Confirmação, Desconhecimento ou Operação Não Realizada — registrados via SEFAZ.
              </p>
            </div>
            <button onClick={loadEvents} disabled={eventsLoading}
              className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-sm rounded-sm transition disabled:opacity-50">
              {eventsLoading ? 'Carregando…' : 'Consultar eventos'}
            </button>
          </div>
          {events && (
            <div className="mt-3">
              {events.error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">
                  {events.error}
                </div>
              )}
              {events.note && events.events.length === 0 && (
                <div className="text-sm text-stone-600 bg-stone-50 border border-stone-200 px-3 py-2 rounded-sm">
                  {events.note}
                </div>
              )}
              {events.events.length > 0 && (
                <table className="w-full text-xs border border-stone-200 rounded-sm">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="text-left px-3 py-2 uppercase tracking-wider text-stone-600">Evento</th>
                      <th className="text-left px-3 py-2 uppercase tracking-wider text-stone-600">Data</th>
                      <th className="text-left px-3 py-2 uppercase tracking-wider text-stone-600">Protocolo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.events.map((ev, i) => (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="px-3 py-2">{ev.type ?? ev.tpEvento ?? ev.descEvento ?? '—'}</td>
                        <td className="px-3 py-2">{ev.date ?? ev.dhEvento ?? '—'}</td>
                        <td className="px-3 py-2 font-mono">{ev.protocol ?? ev.nProt ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-stone-200 text-xs text-stone-500">
            <strong>Para enviar manifestação</strong>, use o painel da Qive em
            <a href={`https://app.qive.com.br/nfe/recebidas/${doc.access_key ?? ''}`} target="_blank" rel="noopener"
              className="ml-1 text-ink underline">app.qive.com.br</a>
            {' '} ou marque a NFe e use a ação "Manifestar" no menu de operações em lote.
          </div>
        </div>
      )}

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
            <div>
              <div className="px-6 pt-4 pb-2 flex gap-2 border-b border-stone-200 bg-stone-50">
                <button onClick={() => setXmlMode('formatted')}
                  className={`px-3 py-1.5 text-sm rounded-sm transition ${xmlMode === 'formatted' ? 'bg-ink text-stone-100' : 'bg-white border border-stone-300 hover:bg-stone-100'}`}>
                  Formatado
                </button>
                <button onClick={() => setXmlMode('raw')}
                  className={`px-3 py-1.5 text-sm rounded-sm transition ${xmlMode === 'raw' ? 'bg-ink text-stone-100' : 'bg-white border border-stone-300 hover:bg-stone-100'}`}>
                  XML cru
                </button>
              </div>
              {xmlMode === 'raw' ? (
                <div className="p-6 bg-stone-50">
                  <pre className="text-xs font-mono text-stone-700 whitespace-pre-wrap break-all max-h-96 overflow-auto bg-white p-4 border border-stone-200 rounded-sm">
                    {doc.xml_content}
                  </pre>
                </div>
              ) : (
                <XmlFormattedView xml={doc.xml_content} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Visualização legível do XML — renderiza todos os elementos folha (com texto)
 * num grid hierárquico, ignorando namespaces e atributos vazios.
 */
function XmlFormattedView({ xml }: { xml: string }) {
  const [tree, setTree] = useState<{ path: string; value: string }[]>([]);

  useEffect(() => {
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const out: { path: string; value: string }[] = [];
      const walker = (node: Element, path: string[]) => {
        const local = node.localName ?? node.nodeName.split(':').pop() ?? node.nodeName;
        const newPath = [...path, local];
        const children = Array.from(node.children) as Element[];
        if (children.length === 0) {
          const txt = (node.textContent ?? '').trim();
          if (txt) out.push({ path: newPath.join(' › '), value: txt });
        } else {
          for (const c of children) walker(c, newPath);
        }
      };
      const root = doc.documentElement;
      if (root) walker(root, []);
      setTree(out);
    } catch {
      setTree([]);
    }
  }, [xml]);

  if (!tree.length) {
    return <div className="p-6 text-sm text-stone-500">Não foi possível parsear o XML.</div>;
  }

  // Agrupa por seção principal (segundo nível do path)
  const groups: Record<string, { path: string; value: string }[]> = {};
  tree.forEach(item => {
    const parts = item.path.split(' › ');
    const section = parts[1] ?? parts[0] ?? 'Outros';
    if (!groups[section]) groups[section] = [];
    groups[section].push(item);
  });

  return (
    <div className="p-6 space-y-4 max-h-[600px] overflow-auto">
      {Object.entries(groups).map(([section, items]) => (
        <div key={section} className="border border-stone-200 rounded-sm">
          <div className="px-4 py-2 bg-stone-50 border-b border-stone-200 text-xs uppercase tracking-wider text-stone-700 font-medium">
            {section}
          </div>
          <table className="w-full text-xs">
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-1.5 text-stone-500 font-mono w-1/2">{item.path}</td>
                  <td className="px-4 py-1.5 text-stone-800 break-all">{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
