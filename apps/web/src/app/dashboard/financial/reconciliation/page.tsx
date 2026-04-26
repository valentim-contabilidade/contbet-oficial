'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { ScanLine, Upload, Trash2, FileSpreadsheet, ChevronRight, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { BankStatement, BankAccount } from '@/lib/types';
import { formatBRL, formatDate, statementStatusLabels, statementStatusColors } from '@/lib/format';
import { PageHeader, Pagination, Modal, ConfirmDeleteModal, Field, Select, PrimaryButton, SecondaryButton } from '@/components/ui';

function ImportModal({ onConfirm, onCancel, current }: { onConfirm: (data: any) => Promise<void>; onCancel: () => void; current: any }) {
  const [bankAccountId, setBankAccountId] = useState('');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/financial/bank-accounts').then(r => setAccounts(r.data.data.filter((a: BankAccount) => a.is_active))).catch(() => {});
  }, []);

  const submit = async () => {
    if (!bankAccountId) { setError('Selecione a conta bancária.'); return; }
    if (!file) { setError('Selecione o arquivo do extrato.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const content = reader.result as string;
          await onConfirm({ bank_account_id: bankAccountId, filename: file.name, content });
        } catch (err: any) {
          setError(err.response?.data?.message ?? 'Erro ao importar.');
          setSubmitting(false);
        }
      };
      reader.onerror = () => {
        setError('Erro ao ler arquivo.');
        setSubmitting(false);
      };
      reader.readAsText(file, 'utf-8');
    } catch (err: any) {
      setError(err.message ?? 'Erro inesperado.');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Conta bancária" required>
        <Select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
          <option value="">Selecione...</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</option>)}
        </Select>
      </Field>
      <Field label="Arquivo do extrato" required>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ofx,.csv,.txt"
          onChange={e => setFile(e.target.files?.[0] || null)}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm rounded-sm file:mr-3 file:py-1 file:px-3 file:rounded-sm file:border-0 file:text-sm file:bg-ink file:text-stone-100 hover:file:bg-ink/90 file:cursor-pointer"
        />
        <div className="text-xs text-stone-500 mt-2 space-y-1">
          <div>📄 <strong>OFX</strong> — formato padrão dos bancos brasileiros (recomendado)</div>
          <div>📊 <strong>CSV</strong> — exportação genérica (deve ter colunas: data, descrição, valor)</div>
        </div>
      </Field>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}
      <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-sm text-sm text-blue-800">
        💡 <strong>Dica:</strong> após o upload, o sistema tentará automaticamente conciliar as linhas do extrato com lançamentos já cadastrados (mesmo valor + data próxima).
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel} disabled={submitting}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !file || !bankAccountId}>
          {submitting ? 'Importando...' : <><Upload className="w-4 h-4 inline mr-2" /> Importar extrato</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function ReconciliationPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<BankStatement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: 'import' | 'delete' | null; data?: BankStatement }>({ type: null });

  const reload = async () => {
    const res = await api.get('/financial/bank-statements', { params: { page } });
    setItems(res.data.data); setTotal(res.data.total);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [page]);

  const handleImport = async (data: any) => {
    await api.post('/financial/bank-statements/import', data);
    setModal({ type: null }); await reload();
  };

  const handleDelete = async () => {
    if (!modal.data) return;
    await api.delete(`/financial/bank-statements/${modal.data.id}`);
    setModal({ type: null }); await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Conciliação Bancária"
        subtitle="Importação e conciliação de extratos"
        action={
          <PrimaryButton onClick={() => setModal({ type: 'import' })}>
            <Upload className="w-4 h-4 inline mr-2" /> Importar extrato
          </PrimaryButton>
        }
      />

      {items.length === 0 && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <FileSpreadsheet className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhum extrato importado</h3>
          <p className="text-stone-600 mb-6">Importe seu primeiro extrato bancário no formato OFX ou CSV para começar.</p>
          <PrimaryButton onClick={() => setModal({ type: 'import' })}>
            <Upload className="w-4 h-4 inline mr-2" /> Importar primeiro extrato
          </PrimaryButton>
        </div>
      )}

      {items.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Arquivo</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Conta</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Período</th>
                  <th className="text-center px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Linhas</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map(s => (
                  <tr key={s.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="w-5 h-5 text-stone-400" strokeWidth={1.5} />
                        <div>
                          <div className="font-medium text-sm">{s.filename}</div>
                          <div className="text-xs text-stone-500">{s.file_format} · {formatDate(s.created_at)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-700">{s.bank_account?.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-stone-700">
                      <div>{formatDate(s.start_date)}</div>
                      <div className="text-stone-500">até {formatDate(s.end_date)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="font-mono text-sm">{s.matched_lines} / {s.total_lines}</div>
                      <div className="w-full bg-stone-200 h-1 rounded-sm overflow-hidden mt-1">
                        <div className="bg-green-600 h-full" style={{ width: `${s.total_lines > 0 ? (s.matched_lines / s.total_lines) * 100 : 0}%` }}></div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${statementStatusColors[s.status]}`}>
                        {statementStatusLabels[s.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link href={`/dashboard/financial/reconciliation/${s.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-ink bg-stone-100 hover:bg-stone-200 rounded-sm transition">
                        <Eye className="w-3.5 h-3.5" /> Conciliar
                      </Link>
                      <button onClick={() => setModal({ type: 'delete', data: s })}
                        className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm ml-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination page={page} setPage={setPage} total={total} />

      {user && (
        <Modal open={modal.type === 'import'} onClose={() => setModal({ type: null })} title="Importar extrato bancário" size="lg">
          <ImportModal current={user} onConfirm={handleImport} onCancel={() => setModal({ type: null })} />
        </Modal>
      )}
      <ConfirmDeleteModal open={modal.type === 'delete'} onClose={() => setModal({ type: null })} onConfirm={handleDelete} entityName={modal.data?.filename} entityLabel="o extrato" />
    </div>
  );
}
