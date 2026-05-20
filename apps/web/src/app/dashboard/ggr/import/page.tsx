'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload, Download, ArrowLeft, FileSpreadsheet, CheckCircle, AlertTriangle, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, todayInput } from '@/lib/format';
import { PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton, Modal } from '@/components/ui';
import { CurrencyInput } from '@/components/financial-ui';
import type { Brand, Company } from '@/lib/types';

function ManualEntryModal({ brands, companies, current, onSubmit, onCancel }: {
  brands: Brand[];
  companies: Company[];
  current: any;
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [data, setData] = useState({
    company_id: current.profile === 'MANAGER' ? current.company_id : '',
    brand_id: '',
    date: todayInput(),
    total_bets: 0,
    total_prizes: 0,
    total_deposits: 0,
    total_withdrawals: 0,
    total_bonus: 0,
    bet_count: 0,
    prize_count: 0,
    deposit_count: 0,
    withdrawal_count: 0,
    active_players: 0,
    notes: '',
  });
  const visibleCompanies = current.profile === 'MANAGER' ? companies.filter(c => c.id === current.company_id) : companies;
  const visibleBrands = data.company_id ? brands.filter(b => b.company_id === data.company_id) : [];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!data.brand_id) errs.brand_id = 'Marca obrigatória';
    if (!data.date) errs.date = 'Data obrigatória';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setSubmitting(true);
      try {
        // company_id é derivado do brand no backend — não enviar.
        const { company_id: _ignored, ...payload } = data;
        await onSubmit(payload);
      } catch (err: any) { setErrors({ form: err.response?.data?.message ?? 'Erro ao salvar.' }); }
      finally { setSubmitting(false); }
    }
  };

  const ggr = data.total_bets - data.total_prizes;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Empresa" required>
          <Select value={data.company_id} disabled={current.profile === 'MANAGER'}
            onChange={e => setData({ ...data, company_id: e.target.value, brand_id: '' })}>
            <option value="">Selecione...</option>
            {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Marca" required error={errors.brand_id}>
          <Select value={data.brand_id} onChange={e => setData({ ...data, brand_id: e.target.value })} disabled={!data.company_id}>
            <option value="">{data.company_id ? 'Selecione...' : 'Selecione a empresa primeiro'}</option>
            {visibleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Data" required error={errors.date}>
        <Input type="date" value={data.date} onChange={e => setData({ ...data, date: e.target.value })} />
      </Field>

      <div className="bg-amber-50/50 border border-amber-200 rounded-sm p-4">
        <div className="text-xs uppercase tracking-wider text-amber-900 font-medium mb-3">Volumes operacionais</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Apostas (Stakes)">
            <CurrencyInput value={data.total_bets} onChange={v => setData({ ...data, total_bets: v })} />
          </Field>
          <Field label="Prêmios pagos">
            <CurrencyInput value={data.total_prizes} onChange={v => setData({ ...data, total_prizes: v })} />
          </Field>
        </div>
        <div className="mt-3 text-xs text-amber-900">
          <strong>GGR resultante:</strong> {formatBRL(ggr)} <span className="text-amber-700">(apostas − prêmios)</span>
        </div>
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-sm p-4">
        <div className="text-xs uppercase tracking-wider text-stone-700 font-medium mb-3">Movimentação de carteira</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Depósitos (R$)">
            <CurrencyInput value={data.total_deposits} onChange={v => setData({ ...data, total_deposits: v })} />
          </Field>
          <Field label="Saques (R$)">
            <CurrencyInput value={data.total_withdrawals} onChange={v => setData({ ...data, total_withdrawals: v })} />
          </Field>
          <Field label="Qtd. depósitos">
            <Input type="number" min="0" value={data.deposit_count} onChange={e => setData({ ...data, deposit_count: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Qtd. saques">
            <Input type="number" min="0" value={data.withdrawal_count} onChange={e => setData({ ...data, withdrawal_count: parseInt(e.target.value) || 0 })} />
          </Field>
        </div>
        <p className="text-[11px] text-stone-500 mt-2">Quantidades alimentam a auditoria de tarifas bancárias (taxa contratada × volume de transações).</p>
      </div>

      <div className="bg-purple-50/40 border border-purple-200 rounded-sm p-4">
        <div className="text-xs uppercase tracking-wider text-purple-900 font-medium mb-3">Gamificação (opcional)</div>
        <Field label="Bônus distribuídos no dia (R$)">
          <CurrencyInput value={data.total_bonus} onChange={v => setData({ ...data, total_bonus: v })} />
        </Field>
        <p className="text-[11px] text-stone-500 mt-2">
          Cashback, freebets, depósitos bonificados, pontos resgatados em apostas. Não compõe o GGR (Lei 14.790), mas é despesa de marketing dedutível em IRPJ/CSLL.
        </p>
      </div>

      <details className="bg-stone-50 border border-stone-200 rounded-sm p-4">
        <summary className="text-xs uppercase tracking-wider text-stone-700 font-medium cursor-pointer">Quantidades de apostas e jogadores (opcional)</summary>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Field label="Qtd. apostas">
            <Input type="number" min="0" value={data.bet_count} onChange={e => setData({ ...data, bet_count: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Qtd. prêmios">
            <Input type="number" min="0" value={data.prize_count} onChange={e => setData({ ...data, prize_count: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Jogadores ativos">
            <Input type="number" min="0" value={data.active_players} onChange={e => setData({ ...data, active_players: parseInt(e.target.value) || 0 })} />
          </Field>
        </div>
      </details>

      <Field label="Observações">
        <textarea value={data.notes} onChange={e => setData({ ...data, notes: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm focus:outline-none focus:border-ink rounded-sm min-h-[60px]" maxLength={2000} />
      </Field>

      <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-sm text-xs text-blue-800">
        💡 Se já existir um registro para essa marca + data, ele será <strong>sobrescrito</strong>.
      </div>

      {errors.form && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{errors.form}</div>}
      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting}>{submitting ? 'Salvando...' : 'Salvar registro diário'}</PrimaryButton>
      </div>
    </div>
  );
}

export default function GgrImportPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState(user?.profile === 'MANAGER' ? user.company_id ?? '' : '');
  const [brandId, setBrandId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/brands').then(r => setBrands(r.data.data)).catch(() => {});
    api.get('/companies').then(r => setCompanies(r.data.data)).catch(() => {});
  }, []);

  const visibleCompanies = user?.profile === 'MANAGER' && user.company_id
    ? companies.filter(c => c.id === user.company_id)
    : companies;
  const visibleBrands = companyId ? brands.filter(b => b.company_id === companyId) : [];

  const submit = async () => {
    if (!brandId) { setError('Selecione a marca.'); return; }
    if (!file) { setError('Selecione o arquivo.'); return; }
    setError('');
    setResult(null);
    setSubmitting(true);

    try {
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      const reader = new FileReader();
      
      reader.onload = async () => {
        try {
          let content: string;
          if (isXlsx) {
            // XLSX: lê como ArrayBuffer e converte para base64
            const buffer = reader.result as ArrayBuffer;
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            content = btoa(binary);
          } else {
            // CSV: lê como texto
            content = reader.result as string;
          }

          const res = await api.post('/ggr/import', {
            brand_id: brandId,
            filename: file.name,
            content,
          });
          setResult(res.data);
        } catch (err: any) {
          setError(err.response?.data?.message ?? 'Erro ao importar.');
        } finally {
          setSubmitting(false);
        }
      };
      reader.onerror = () => {
        setError('Erro ao ler arquivo.');
        setSubmitting(false);
      };
      
      if (isXlsx) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file, 'utf-8');
      }
    } catch (err: any) {
      setError(err.message ?? 'Erro inesperado.');
      setSubmitting(false);
    }
  };

  const handleManual = async (data: any) => {
    await api.post('/ggr/manual', data);
    setManualOpen(false);
    router.push('/dashboard/ggr/daily');
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/ggr" className="inline-flex items-center gap-2 text-sm text-stone-600 hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar para painel
      </Link>

      <PageHeader title="Importar dados GGR" subtitle="Carregamento de informações operacionais para apuração" />

      {/* Caixa de download do template */}
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 mb-6 flex items-start gap-4">
        <FileSpreadsheet className="w-6 h-6 text-blue-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-medium text-blue-900 mb-1">Use o template padrão ContBet</h3>
          <p className="text-sm text-blue-800 mb-3">
            Para garantir que a importação funcione 100%, baixe nosso modelo CSV e preencha as colunas obrigatórias: <strong>data, apostas, premios, depositos, saques</strong>. O sistema também aceita variações em inglês (bets, prizes, deposits, withdrawals).
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button"
              onClick={async () => {
                try {
                  const params = brandId ? { brand_id: brandId } : {};
                  const res = await api.get('/ggr/template-xlsx', { params, responseType: 'blob' });
                  const blob = new Blob([res.data], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  const stamp = new Date().toISOString().split('T')[0];
                  a.download = `ggr-modelo-${stamp}.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.URL.revokeObjectURL(url);
                } catch (err: any) {
                  alert(err?.response?.data?.message ?? 'Erro ao baixar modelo Excel.');
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-700 text-white text-xs rounded-sm hover:bg-blue-800 transition">
              <Download className="w-3.5 h-3.5" /> Baixar modelo Excel (.xlsx)
            </button>
            <button type="button"
              onClick={async () => {
                try {
                  const res = await api.get('/ggr/template', { responseType: 'blob' });
                  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'contbet_ggr_template.csv';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  window.URL.revokeObjectURL(url);
                } catch (err: any) {
                  alert(err?.response?.data?.message ?? 'Erro ao baixar modelo CSV.');
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-blue-700 border border-blue-300 text-xs rounded-sm hover:bg-blue-50 transition">
              <Download className="w-3.5 h-3.5" /> Baixar modelo CSV
            </button>
          </div>
          <p className="text-xs text-blue-700 mt-2">
            💡 O Excel vem com 31 dias pré-preenchidos e uma aba "Instruções". Selecione a marca acima antes de baixar pra que o nome do arquivo já saia identificado.
          </p>
        </div>
      </div>

      {/* Formulário de upload */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <h2 className="font-display text-xl mb-4">Upload de arquivo CSV ou XLSX</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Empresa" required>
              <Select value={companyId} disabled={user?.profile === 'MANAGER'}
                onChange={e => { setCompanyId(e.target.value); setBrandId(''); }}>
                <option value="">Selecione a empresa...</option>
                {visibleCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Marca" required>
              <Select value={brandId} onChange={e => setBrandId(e.target.value)} disabled={!companyId}>
                <option value="">{companyId ? 'Selecione a marca...' : 'Selecione a empresa primeiro'}</option>
                {visibleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Arquivo" required>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm rounded-sm file:mr-3 file:py-1 file:px-3 file:rounded-sm file:border-0 file:text-sm file:bg-ink file:text-stone-100 hover:file:bg-ink/90 file:cursor-pointer"
            />
            <div className="text-xs text-stone-500 mt-2 space-y-1">
              <div>📄 <strong>CSV</strong> — separadores aceitos: vírgula, ponto-e-vírgula ou tab</div>
              <div>📊 <strong>XLSX</strong> — primeira aba será lida (ignora as demais)</div>
            </div>
          </Field>

          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
            <SecondaryButton type="button" onClick={() => setManualOpen(true)}>
              <Plus className="w-4 h-4 inline mr-2" /> Ou cadastrar manual (1 dia)
            </SecondaryButton>
            <PrimaryButton type="button" onClick={submit} disabled={submitting || !file || !brandId}>
              {submitting ? 'Importando...' : <><Upload className="w-4 h-4 inline mr-2" /> Importar arquivo</>}
            </PrimaryButton>
          </div>
        </div>
      </div>

      {/* Resultado */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-sm p-6">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle className="w-6 h-6 text-green-700 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-green-900 mb-1">Importação concluída!</h3>
              <p className="text-sm text-green-800">Arquivo: <strong>{result.filename}</strong> · Formato: {result.format}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-green-200 rounded-sm p-3 text-center">
              <div className="text-xs uppercase tracking-wider text-green-700">Total no arquivo</div>
              <div className="font-display text-2xl text-green-900">{result.total_lines}</div>
            </div>
            <div className="bg-white border border-green-200 rounded-sm p-3 text-center">
              <div className="text-xs uppercase tracking-wider text-green-700">Novos registros</div>
              <div className="font-display text-2xl text-green-900">{result.created}</div>
            </div>
            <div className="bg-white border border-green-200 rounded-sm p-3 text-center">
              <div className="text-xs uppercase tracking-wider text-amber-700">Atualizados</div>
              <div className="font-display text-2xl text-amber-900">{result.updated}</div>
            </div>
          </div>
          {result.warnings && result.warnings.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-sm p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <strong className="text-sm text-amber-900">Avisos durante a importação:</strong>
              </div>
              <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5">
                {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Link href="/dashboard/ggr/daily" className="px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
              Ver registros importados
            </Link>
            <Link href="/dashboard/ggr" className="px-4 py-2 bg-white border border-stone-300 text-sm rounded-sm hover:bg-stone-100 transition">
              Voltar ao painel
            </Link>
          </div>
        </div>
      )}

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Lançamento manual de um dia" size="lg">
        <ManualEntryModal brands={brands} companies={companies} current={user} onSubmit={handleManual} onCancel={() => setManualOpen(false)} />
      </Modal>
    </div>
  );
}
