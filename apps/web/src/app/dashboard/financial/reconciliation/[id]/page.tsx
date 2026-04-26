'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle, Plus, Search, ArrowUpRight, ArrowDownLeft, AlertCircle, Undo, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import type { BankStatement, BankStatementLine, Transaction, FinancialCategory } from '@/lib/types';
import { formatBRL, formatDate, statementStatusLabels, statementStatusColors, lineStatusLabels, lineStatusColors } from '@/lib/format';
import { Modal, Field, Select, PrimaryButton, SecondaryButton } from '@/components/ui';
import { MoneyText } from '@/components/financial-ui';

function CreateTransactionFromLineModal({ line, statement, onConfirm, onCancel }: {
  line: BankStatementLine;
  statement: BankStatement;
  onConfirm: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/financial/categories', {
      params: { company_id: statement.company_id, type: line.type === 'CREDIT' ? 'INCOME' : 'EXPENSE' }
    }).then(r => setCategories(r.data.data)).catch(() => {});
  }, [statement.company_id, line.type]);

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const payload: any = {};
      if (categoryId) payload.category_id = categoryId;
      if (notes) payload.notes = notes;
      await onConfirm(payload);
    } catch (err: any) { setError(err.response?.data?.message ?? 'Erro.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-stone-50 p-4 rounded-sm border border-stone-200">
        <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Linha do extrato</div>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-medium">{line.description}</div>
            <div className="text-xs text-stone-500 mt-1">{formatDate(line.date)}</div>
          </div>
          <div className={`font-mono ${line.type === 'CREDIT' ? 'text-green-700' : 'text-red-700'}`}>
            {line.type === 'CREDIT' ? '+ ' : '- '}{formatBRL(line.amount)}
          </div>
        </div>
      </div>
      <Field label="Categoria">
        <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">— Sem categoria —</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Observações">
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Detalhes adicionais sobre essa transação..."
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}
      <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-sm text-xs text-blue-800">
        💡 Será criado um lançamento com os mesmos dados da linha do extrato (data, valor, descrição) e o saldo da conta bancária será atualizado automaticamente.
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>
          {submitting ? 'Criando...' : 'Criar lançamento'}
        </PrimaryButton>
      </div>
    </div>
  );
}

function MatchSuggestionsModal({ line, onSelect, onCancel }: {
  line: BankStatementLine;
  onSelect: (txId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/financial/bank-statements/lines/${line.id}/suggest`)
      .then(r => setSuggestions(r.data))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [line.id]);

  return (
    <div className="space-y-4">
      <div className="bg-stone-50 p-4 rounded-sm border border-stone-200">
        <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Linha a ser conciliada</div>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-medium">{line.description}</div>
            <div className="text-xs text-stone-500 mt-1">{formatDate(line.date)}</div>
          </div>
          <div className={`font-mono ${line.type === 'CREDIT' ? 'text-green-700' : 'text-red-700'}`}>
            {line.type === 'CREDIT' ? '+ ' : '- '}{formatBRL(line.amount)}
          </div>
        </div>
      </div>
      <div className="text-xs uppercase tracking-wider text-stone-500">Lançamentos candidatos (±7 dias, mesmo tipo)</div>
      {loading && <div className="text-center text-stone-500 py-8">Buscando sugestões...</div>}
      {!loading && suggestions.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 px-4 py-3 rounded-sm text-sm text-amber-900">
          Nenhum lançamento compatível encontrado. Use "Criar lançamento" para gerar um novo a partir desta linha.
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {suggestions.map(tx => (
            <button key={tx.id} onClick={() => onSelect(tx.id)}
              className="w-full text-left bg-white border border-stone-200 rounded-sm p-3 hover:border-ink hover:bg-stone-50 transition">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm">{tx.description}</div>
                  <div className="text-xs text-stone-500 mt-1">{formatDate(tx.date)}</div>
                </div>
                <div className={`font-mono text-sm ${tx.type === 'INCOME' ? 'text-green-700' : 'text-red-700'}`}>
                  {tx.type === 'INCOME' ? '+ ' : '- '}{formatBRL(tx.amount)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Fechar</SecondaryButton>
      </div>
    </div>
  );
}

export default function ReconciliationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [statement, setStatement] = useState<BankStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'UNMATCHED' | 'MATCHED' | 'IGNORED'>('ALL');
  const [modal, setModal] = useState<{ type: 'create' | 'suggest' | null; data?: BankStatementLine }>({ type: null });

  const reload = async () => {
    const res = await api.get(`/financial/bank-statements/${id}`);
    setStatement(res.data);
  };

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [id]);

  const handleMatch = async (txId: string) => {
    if (!modal.data) return;
    await api.post(`/financial/bank-statements/lines/${modal.data.id}/match`, { transaction_id: txId });
    setModal({ type: null });
    await reload();
  };

  const handleCreate = async (data: any) => {
    if (!modal.data) return;
    await api.post(`/financial/bank-statements/lines/${modal.data.id}/create-transaction`, data);
    setModal({ type: null });
    await reload();
  };

  const handleIgnore = async (lineId: string) => {
    if (!confirm('Ignorar esta linha? Ela não será conciliada.')) return;
    await api.post(`/financial/bank-statements/lines/${lineId}/ignore`);
    await reload();
  };

  const handleUnmatch = async (lineId: string) => {
    if (!confirm('Desfazer conciliação desta linha?')) return;
    await api.post(`/financial/bank-statements/lines/${lineId}/unmatch`);
    await reload();
  };

  if (loading) return <div className="text-center text-stone-500 py-20">Carregando extrato...</div>;
  if (!statement) return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Extrato não encontrado.</div>;

  const lines = statement.lines || [];
  const filtered = filter === 'ALL' ? lines :
    filter === 'UNMATCHED' ? lines.filter(l => l.status === 'UNMATCHED') :
    filter === 'MATCHED' ? lines.filter(l => l.status === 'MATCHED' || l.status === 'CREATED') :
    lines.filter(l => l.status === 'IGNORED');

  const counts = {
    all: lines.length,
    unmatched: lines.filter(l => l.status === 'UNMATCHED').length,
    matched: lines.filter(l => l.status === 'MATCHED' || l.status === 'CREATED').length,
    ignored: lines.filter(l => l.status === 'IGNORED').length,
  };

  return (
    <div>
      <Link href="/dashboard/financial/reconciliation" className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar para extratos
      </Link>

      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500 mb-1">Conciliação</div>
            <h1 className="font-display text-3xl mb-2">{statement.filename}</h1>
            <div className="text-sm text-stone-600">
              <strong>{statement.bank_account?.name}</strong> · período de {formatDate(statement.start_date)} a {formatDate(statement.end_date)}
            </div>
            {statement.final_balance !== null && (
              <div className="text-sm text-stone-600 mt-1">
                Saldo final no extrato: <strong>{formatBRL(statement.final_balance)}</strong>
              </div>
            )}
          </div>
          <span className={`text-xs px-3 py-1.5 rounded-sm uppercase tracking-wider ${statementStatusColors[statement.status]}`}>
            {statementStatusLabels[statement.status]}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-4">
          <div className="bg-stone-50 p-3 rounded-sm border border-stone-200">
            <div className="text-xs uppercase tracking-wider text-stone-500">Total</div>
            <div className="font-display text-2xl">{counts.all}</div>
          </div>
          <div className="bg-green-50 p-3 rounded-sm border border-green-200">
            <div className="text-xs uppercase tracking-wider text-green-700">Conciliadas</div>
            <div className="font-display text-2xl text-green-800">{counts.matched}</div>
          </div>
          <div className="bg-amber-50 p-3 rounded-sm border border-amber-200">
            <div className="text-xs uppercase tracking-wider text-amber-700">Pendentes</div>
            <div className="font-display text-2xl text-amber-800">{counts.unmatched}</div>
          </div>
          <div className="bg-stone-100 p-3 rounded-sm border border-stone-200">
            <div className="text-xs uppercase tracking-wider text-stone-600">Ignoradas</div>
            <div className="font-display text-2xl text-stone-700">{counts.ignored}</div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilter('ALL')}
          className={`px-3 py-1.5 text-xs rounded-sm border transition ${filter === 'ALL' ? 'bg-ink text-stone-100 border-ink' : 'bg-white border-stone-300 hover:border-stone-400'}`}>
          Todas ({counts.all})
        </button>
        <button onClick={() => setFilter('UNMATCHED')}
          className={`px-3 py-1.5 text-xs rounded-sm border transition ${filter === 'UNMATCHED' ? 'bg-amber-100 text-amber-900 border-amber-400' : 'bg-white border-stone-300 hover:border-stone-400'}`}>
          Pendentes ({counts.unmatched})
        </button>
        <button onClick={() => setFilter('MATCHED')}
          className={`px-3 py-1.5 text-xs rounded-sm border transition ${filter === 'MATCHED' ? 'bg-green-100 text-green-900 border-green-400' : 'bg-white border-stone-300 hover:border-stone-400'}`}>
          Conciliadas ({counts.matched})
        </button>
        <button onClick={() => setFilter('IGNORED')}
          className={`px-3 py-1.5 text-xs rounded-sm border transition ${filter === 'IGNORED' ? 'bg-stone-200 text-stone-800 border-stone-400' : 'bg-white border-stone-300 hover:border-stone-400'}`}>
          Ignoradas ({counts.ignored})
        </button>
      </div>

      {/* Lista de linhas */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-white border border-stone-200 rounded-sm p-12 text-center text-stone-500">
            Nenhuma linha nesse filtro.
          </div>
        )}
        {filtered.map(line => (
          <div key={line.id} className="bg-white border border-stone-200 rounded-sm p-4 hover:border-stone-300 transition">
            <div className="flex items-start justify-between gap-4">
              {/* Coluna 1: linha do extrato */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {line.type === 'CREDIT' ? <ArrowDownLeft className="w-4 h-4 text-green-600 flex-shrink-0" strokeWidth={1.5} /> : <ArrowUpRight className="w-4 h-4 text-red-500 flex-shrink-0" strokeWidth={1.5} />}
                  <span className="text-xs uppercase tracking-wider text-stone-500">Linha do extrato</span>
                  <span className={`text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider ${lineStatusColors[line.status]}`}>
                    {lineStatusLabels[line.status]}
                  </span>
                  {line.match_score !== null && line.match_score !== undefined && line.status === 'MATCHED' && (
                    <span className="text-xs text-stone-500" title="Confiança do match">{line.match_score}%</span>
                  )}
                </div>
                <div className="font-medium text-sm truncate">{line.description}</div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {formatDate(line.date)}
                  {line.fit_id && <span className="ml-2 font-mono">FITID: {line.fit_id}</span>}
                </div>
              </div>

              {/* Coluna 2: valor */}
              <div className="text-right flex-shrink-0">
                <div className={`font-mono ${line.type === 'CREDIT' ? 'text-green-700' : 'text-red-700'}`}>
                  {line.type === 'CREDIT' ? '+ ' : '- '}{formatBRL(line.amount)}
                </div>
              </div>
            </div>

            {/* Transação conciliada */}
            {line.transaction && (
              <div className="mt-3 pt-3 border-t border-stone-100 bg-green-50/30 -mx-4 -mb-4 px-4 py-3 rounded-b-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-green-800">Conciliado com:</div>
                      <div className="text-sm font-medium truncate">{line.transaction.description}</div>
                      <div className="text-xs text-stone-500">{formatDate(line.transaction.date)} · {formatBRL(line.transaction.amount)}</div>
                    </div>
                  </div>
                  <button onClick={() => handleUnmatch(line.id)}
                    className="text-xs text-stone-500 hover:text-red-600 flex items-center gap-1 flex-shrink-0">
                    <Undo className="w-3.5 h-3.5" /> Desfazer
                  </button>
                </div>
              </div>
            )}

            {/* Ações para linha não conciliada */}
            {line.status === 'UNMATCHED' && (
              <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap gap-2">
                <button onClick={() => setModal({ type: 'suggest', data: line })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-sm hover:bg-blue-100 transition">
                  <Sparkles className="w-3.5 h-3.5" /> Buscar lançamento
                </button>
                <button onClick={() => setModal({ type: 'create', data: line })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-800 border border-green-200 rounded-sm hover:bg-green-100 transition">
                  <Plus className="w-3.5 h-3.5" /> Criar lançamento
                </button>
                <button onClick={() => handleIgnore(line.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-stone-50 text-stone-700 border border-stone-200 rounded-sm hover:bg-stone-100 transition">
                  <XCircle className="w-3.5 h-3.5" /> Ignorar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={modal.type === 'create'} onClose={() => setModal({ type: null })} title="Criar lançamento a partir desta linha" size="md">
        {modal.data && statement && <CreateTransactionFromLineModal line={modal.data} statement={statement} onConfirm={handleCreate} onCancel={() => setModal({ type: null })} />}
      </Modal>
      <Modal open={modal.type === 'suggest'} onClose={() => setModal({ type: null })} title="Conciliar com lançamento existente" size="lg">
        {modal.data && <MatchSuggestionsModal line={modal.data} onSelect={handleMatch} onCancel={() => setModal({ type: null })} />}
      </Modal>
    </div>
  );
}
