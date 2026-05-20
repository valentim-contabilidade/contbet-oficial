'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, CheckCircle2, AlertTriangle, ShieldCheck, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, formatDate } from '@/lib/format';
import { PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton, Modal } from '@/components/ui';

interface Brand { id: string; name: string }
interface MatchOption {
  id: string;
  issue_date: string;
  document_number: string;
  total_amount: string | number;
  description: string;
}

export default function ClaimDocumentPage() {
  const { user } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [data, setData] = useState({ document_number: '', issuer_cnpj: '', total_amount: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ message: string; warning: string | null } | null>(null);
  const [matches, setMatches] = useState<MatchOption[] | null>(null);

  useEffect(() => {
    // Lista das marcas que o gestor pode reivindicar
    api.get('/brands', { params: { mine: 'true' } })
      .then(r => {
        const list: Brand[] = r.data?.data ?? [];
        setBrands(list);
        if (list.length === 1) setBrandId(list[0].id);
      })
      .catch(() => setBrands([]));
  }, [user]);

  const formatCnpjMask = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  };

  const reset = () => {
    setData({ document_number: '', issuer_cnpj: '', total_amount: '' });
    setError(''); setMatches(null);
  };

  const submit = async (pickId?: string) => {
    setError(''); setSuccess(null); setSubmitting(true);
    try {
      const body: any = {
        document_number: data.document_number.trim(),
        issuer_cnpj: data.issuer_cnpj.replace(/\D/g, ''),
        total_amount: Number(String(data.total_amount).replace(/\./g, '').replace(',', '.')),
        brand_id: brandId,
      };
      if (pickId) body.pick_document_id = pickId;

      const res = await api.post('/fiscal/documents/claim', body);

      if (res.data?.multiple) {
        setMatches(res.data.matches);
        return;
      }
      setSuccess({
        message: 'Nota reivindicada e contabilizada como conta a pagar.',
        warning: res.data?.amount_diff_warning ?? null,
      });
      setMatches(null);
      reset();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Erro ao reivindicar nota.');
      setMatches(null);
    } finally { setSubmitting(false); }
  };

  if (!user) return null;
  if (user.profile !== 'OWNER') {
    return (
      <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">
        Esta página é exclusiva para gestores de marca. Use{' '}
        <Link href="/dashboard/fiscal/documents" className="text-ink underline">Notas Fiscais</Link> para gerenciar todas.
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Reivindicar nota fiscal"
        subtitle="Informe os 3 dados (número, CNPJ e valor) — o sistema localiza a nota no cofre"
      />

      <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 mb-6 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-blue-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          Por privacidade entre marcas, você não vê o cofre completo. Para reivindicar uma NF que recebeu,
          informe o <strong>número</strong>, <strong>CNPJ do emitente</strong> e <strong>valor total</strong>.
          Se a nota estiver no cofre, ela é transferida pra sua marca e vira conta a pagar automaticamente.
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="bg-white border border-stone-200 rounded-sm p-6 space-y-4">
        {brands.length > 1 && (
          <Field label="Marca" required>
            <Select value={brandId} onChange={e => setBrandId(e.target.value)}>
              <option value="">Selecione...</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Número da nota" required>
            <Input value={data.document_number} placeholder="Ex: 12345"
              onChange={e => setData({ ...data, document_number: e.target.value })} />
          </Field>
          <Field label="CNPJ do emitente" required>
            <Input value={data.issuer_cnpj} placeholder="00.000.000/0000-00"
              onChange={e => setData({ ...data, issuer_cnpj: formatCnpjMask(e.target.value) })}
              maxLength={18} />
          </Field>
        </div>

        <Field label="Valor total (R$)" required>
          <Input value={data.total_amount} placeholder="1.234,56"
            onChange={e => setData({ ...data, total_amount: e.target.value })}
            inputMode="decimal" />
          <div className="text-xs text-stone-500 mt-1">Tolerância de ±R$ 0,01. Diferenças maiores não casam.</div>
        </Field>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {success && (
          <div className="text-sm text-green-800 bg-green-50 border border-green-200 px-3 py-2 rounded-sm flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div>{success.message}</div>
              {success.warning && <div className="text-amber-800 mt-1">⚠ {success.warning}</div>}
              <Link href="/dashboard/fiscal/my-documents" className="underline text-xs mt-2 inline-block">Ver minhas notas →</Link>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
          <SecondaryButton type="button" onClick={reset} disabled={submitting}>Limpar</SecondaryButton>
          <PrimaryButton type="submit" disabled={submitting || !brandId}>
            {submitting ? 'Buscando…' : <><Search className="w-4 h-4 inline mr-2" /> Reivindicar nota</>}
          </PrimaryButton>
        </div>
      </form>

      {/* Modal de múltiplos matches */}
      <Modal open={!!matches} onClose={() => setMatches(null)}
        title="Foram encontradas várias notas com esses dados" size="lg">
        <div className="space-y-3">
          <p className="text-sm text-stone-700">
            Selecione qual nota deseja reivindicar. As outras continuam no cofre.
          </p>
          {matches?.map(m => (
            <button key={m.id} type="button"
              onClick={() => submit(m.id)}
              disabled={submitting}
              className="w-full text-left bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-sm p-3 transition flex items-start gap-3">
              <FileText className="w-5 h-5 text-stone-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium text-sm">Nº {m.document_number}</div>
                <div className="text-xs text-stone-500">Emissão: {formatDate(m.issue_date)}</div>
                {m.description && <div className="text-xs text-stone-600 mt-1 line-clamp-1">{m.description}</div>}
              </div>
              <div className="font-mono text-sm">{formatBRL(m.total_amount)}</div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
