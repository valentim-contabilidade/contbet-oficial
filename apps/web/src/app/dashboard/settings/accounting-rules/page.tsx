'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, RotateCcw, Save, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  PageHeader, Modal, Field, Input, Select,
  PrimaryButton, SecondaryButton,
} from '@/components/ui';

interface Rule {
  id: string;
  event_key: string;
  group: string;
  label: string;
  description: string | null;
  debit_code: string | null;
  credit_code: string | null;
  historic_code: number | null;
  historic_template: string | null;
  active: boolean;
}

const GROUP_LABELS: Record<string, string> = {
  GGR_DAILY: 'GGR Diário',
  PAYABLE_PAID: 'Pagamentos',
  RECEIVABLE: 'Recebimentos',
  TAX_APURATION: 'Apurações (Provisões)',
  BANK: 'Contas Bancárias',
};

export default function AccountingRulesPage() {
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [accountsByCode, setAccountsByCode] = useState<Record<string, string>>({});
  const [defaultAccounts, setDefaultAccounts] = useState<{ code: string; name: string; type: string }[]>([]);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    const r = await api.get('/accounting/rules');
    setRules(r.data.data);
    setAccountsByCode(r.data.accounts_by_code ?? {});
    setDefaultAccounts(r.data.default_accounts ?? []);
  };

  const accountLabel = (code: string | null) => {
    if (!code) return '—';
    const name = accountsByCode[code];
    return name ? `${code} · ${name}` : code;
  };

  useEffect(() => { reload(); }, []);

  const grouped = useMemo(() => {
    const g: Record<string, Rule[]> = {};
    for (const r of rules) {
      (g[r.group] ??= []).push(r);
    }
    return g;
  }, [rules]);

  const syncDefaults = async () => {
    if (!confirm('Sincronizar catálogo? Insere event_keys novos do código (não sobrescreve regras já editadas).')) return;
    setLoading(true);
    try {
      const r = await api.post('/accounting/rules/sync-defaults');
      alert(`✓ ${r.data.created} regra(s) nova(s) adicionada(s). Catálogo: ${r.data.total_default}.`);
      await reload();
    } finally { setLoading(false); }
  };

  const resetRule = async (rule: Rule) => {
    if (!confirm(`Restaurar "${rule.label}" para os valores padrão do catálogo?`)) return;
    setLoading(true);
    try {
      await api.post(`/accounting/rules/${rule.id}/reset`);
      await reload();
    } finally { setLoading(false); }
  };

  if (user?.profile !== 'ADMIN') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div>
      <PageHeader
        title="Regras de lançamento contábil"
        subtitle="Configurações · Parametrização do escritório"
        action={
          <SecondaryButton onClick={syncDefaults} disabled={loading}>
            <RefreshCw className={`w-4 h-4 inline mr-2 ${loading ? 'animate-spin' : ''}`} />
            Sincronizar catálogo
          </SecondaryButton>
        }
      />

      <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 mb-6 text-sm text-blue-900">
        Estas regras determinam quais contas (D/C) e qual histórico Domínio cada tipo de movimentação
        automática usa ao gerar lançamentos contábeis. Códigos seguem o <strong>Plano Padrão Lei 14.790</strong>;
        cada empresa resolve o código para a conta cadastrada no seu próprio plano.
      </div>

      {Object.entries(grouped).map(([group, items]) => (
        <div key={group} className="mb-8">
          <h2 className="font-display text-xl mb-3">{GROUP_LABELS[group] ?? group}</h2>
          <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Evento</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Débito</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Crédito</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Hist.</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Template histórico</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <BookOpenCheck className="w-4 h-4 text-stone-400" strokeWidth={1.5} />
                        <div>
                          <div className="font-medium">{r.label}</div>
                          <div className="font-mono text-[10px] text-stone-400">{r.event_key}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.debit_code ? (
                        <div>
                          <div className="font-mono text-stone-700">{r.debit_code}</div>
                          <div className="text-stone-500">{accountsByCode[r.debit_code] ?? ''}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.credit_code ? (
                        <div>
                          <div className="font-mono text-stone-700">{r.credit_code}</div>
                          <div className="text-stone-500">{accountsByCode[r.credit_code] ?? ''}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{r.historic_code ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-stone-600 max-w-md truncate">{r.historic_template ?? '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(r)} className="px-2 py-1 text-xs text-ink hover:bg-stone-100 rounded-sm">Editar</button>
                      <button onClick={() => resetRule(r)} disabled={loading} className="px-2 py-1 text-xs text-stone-500 hover:text-amber-700 hover:bg-amber-50 rounded-sm ml-1" title="Restaurar default">
                        <RotateCcw className="w-3.5 h-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Editar regra · ${editing?.label ?? ''}`} size="lg">
        {editing && (
          <RuleForm
            rule={editing}
            accountsByCode={accountsByCode}
            defaultAccounts={defaultAccounts}
            onSubmit={async (patch) => {
              await api.patch(`/accounting/rules/${editing.id}`, patch);
              setEditing(null);
              await reload();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function RuleForm({ rule, accountsByCode, defaultAccounts, onSubmit, onCancel }: {
  rule: Rule;
  accountsByCode: Record<string, string>;
  defaultAccounts: { code: string; name: string; type: string }[];
  onSubmit: (patch: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [data, setData] = useState({
    label: rule.label,
    debit_code: rule.debit_code ?? '',
    credit_code: rule.credit_code ?? '',
    historic_code: rule.historic_code != null ? String(rule.historic_code) : '',
    historic_template: rule.historic_template ?? '',
    active: rule.active,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await onSubmit({
        label: data.label,
        debit_code: data.debit_code || null,
        credit_code: data.credit_code || null,
        historic_code: data.historic_code === '' ? null : Number(data.historic_code),
        historic_template: data.historic_template || null,
        active: data.active,
      });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Erro ao salvar.');
    } finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="text-xs text-stone-500 font-mono">{rule.event_key}</div>
      {rule.description && <div className="text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-sm">{rule.description}</div>}

      <Field label="Rótulo (descrição interna)">
        <Input value={data.label} onChange={e => setData({ ...data, label: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Conta de Débito">
          <Select value={data.debit_code} onChange={e => setData({ ...data, debit_code: e.target.value })}>
            <option value="">— sem débito —</option>
            {defaultAccounts.map(a => (
              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
            ))}
          </Select>
          {data.debit_code && !accountsByCode[data.debit_code] && (
            <div className="text-xs text-amber-700 mt-1">Código não encontrado no plano modelo.</div>
          )}
        </Field>
        <Field label="Conta de Crédito">
          <Select value={data.credit_code} onChange={e => setData({ ...data, credit_code: e.target.value })}>
            <option value="">— sem crédito —</option>
            {defaultAccounts.map(a => (
              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
            ))}
          </Select>
          {data.credit_code && !accountsByCode[data.credit_code] && (
            <div className="text-xs text-amber-700 mt-1">Código não encontrado no plano modelo.</div>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Cód. Histórico (Domínio)">
          <Input type="number" value={data.historic_code} onChange={e => setData({ ...data, historic_code: e.target.value })} placeholder="1-999" />
        </Field>
        <div className="col-span-2">
          <Field label="Template do histórico">
            <Input value={data.historic_template} onChange={e => setData({ ...data, historic_template: e.target.value })} placeholder="Ex: Pagamento de {fornecedor} ref. {documento}" />
          </Field>
        </div>
      </div>

      <div className="text-xs text-stone-500">
        Placeholders aceitos no template: <code>{'{brand}'}</code>, <code>{'{date}'}</code>, <code>{'{fornecedor}'}</code>, <code>{'{cliente}'}</code>, <code>{'{documento}'}</code>, <code>{'{periodo}'}</code>.
      </div>

      <Field label="Status">
        <Select value={data.active ? '1' : '0'} onChange={e => setData({ ...data, active: e.target.value === '1' })}>
          <option value="1">Ativa</option>
          <option value="0">Inativa (usa fallback hard-coded)</option>
        </Select>
      </Field>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="submit" disabled={submitting}>
          <Save className="w-4 h-4 inline mr-2" />
          {submitting ? 'Salvando...' : 'Salvar'}
        </PrimaryButton>
      </div>
    </form>
  );
}
