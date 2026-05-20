'use client';

import { useEffect, useState } from 'react';
import { Key, Upload, Trash2, Calendar, Shield, ShieldAlert, ShieldX, AlertTriangle, CheckCircle, Eye, EyeOff, FileKey, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Company } from '@/lib/types';
import type { FiscalCertificate, FiscalCertificateStatus } from '@/lib/fiscal-types';
import { certificateStatusLabels, certificateStatusColors, daysUntilExpiration, readFileAsBase64 } from '@/lib/fiscal-format';
import { formatDate, formatDocument } from '@/lib/format';
import { PageHeader, Field, Input, Select, PrimaryButton, SecondaryButton, Modal, ConfirmDeleteModal } from '@/components/ui';

const statusIcons: Record<string, any> = {
  ACTIVE: Shield,
  EXPIRED: ShieldX,
  REVOKED: ShieldAlert,
  ERROR: AlertTriangle,
};

function UploadModal({ companyId, onUploaded, onCancel }: { companyId: string; onUploaded: () => Promise<void>; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError('');
    if (!file) { setError('Selecione o arquivo .pfx'); return; }
    if (!password) { setError('Informe a senha'); return; }

    setSubmitting(true);
    try {
      const pfx_base64 = await readFileAsBase64(file);
      await api.post('/fiscal/certificates', {
        company_id: companyId,
        pfx_base64,
        password,
        notes: notes || undefined,
      });
      await onUploaded();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Erro ao processar certificado');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-sm p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-700 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800 space-y-1">
          <div><strong>Antes de prosseguir:</strong></div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>O certificado deve ser <strong>A1 (.pfx)</strong> emitido pela ICP-Brasil</li>
            <li>O <strong>CNPJ do certificado precisa bater</strong> com o da empresa selecionada</li>
            <li>O certificado <strong>não pode estar expirado</strong></li>
            <li>O sistema vai <strong>fazer upload no PlugNotas</strong> automaticamente</li>
          </ul>
        </div>
      </div>

      <Field label="Arquivo do certificado (.pfx ou .p12)" required>
        <input type="file" accept=".pfx,.p12"
          onChange={e => setFile(e.target.files?.[0] || null)}
          className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 text-sm rounded-sm file:mr-3 file:py-1 file:px-3 file:rounded-sm file:border-0 file:text-sm file:bg-ink file:text-stone-100 hover:file:bg-ink/90 file:cursor-pointer"
        />
        {file && (
          <div className="text-xs text-stone-600 mt-1 flex items-center gap-2">
            <FileKey className="w-3.5 h-3.5" />
            {file.name} <span className="text-stone-400">·</span> {(file.size / 1024).toFixed(1)} KB
          </div>
        )}
      </Field>

      <Field label="Senha do certificado" required>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="pr-10"
            autoFocus
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-ink">
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="text-xs text-stone-500 mt-1">A senha será criptografada (AES-256-GCM) antes de salvar no banco.</div>
      </Field>

      <Field label="Observações (opcional)">
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: Certificado renovado em janeiro/2026" />
      </Field>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
        <SecondaryButton type="button" onClick={onCancel} disabled={submitting}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={submit} disabled={submitting || !file || !password}>
          {submitting ? 'Processando...' : <><Upload className="w-4 h-4 inline mr-2" /> Fazer upload</>}
        </PrimaryButton>
      </div>
    </div>
  );
}

export default function FiscalCertificatesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [certs, setCerts] = useState<FiscalCertificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FiscalCertificate | null>(null);

  useEffect(() => {
    api.get('/companies', { params: { include_office: 'true' } }).then(r => {
      setCompanies(r.data.data);
      if (user?.profile === 'MANAGER' && user.company_id) setCompanyId(user.company_id);
      else if (r.data.data.length > 0) setCompanyId(r.data.data[0].id);
    });
  }, [user]);

  const reload = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await api.get(`/fiscal/certificates/${companyId}`);
      setCerts(res.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [companyId]);

  const handleUploaded = async () => {
    setUploadOpen(false);
    await reload();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await api.delete(`/fiscal/certificates/${deleteTarget.id}`);
    setDeleteTarget(null);
    await reload();
  };

  if (user?.profile !== 'ADMIN' && user?.profile !== 'MANAGER') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Sem permissão.</div>;
  }

  const activeCert = certs.find(c => c.status === 'ACTIVE');
  const hasActive = !!activeCert;

  return (
    <div>
      <PageHeader
        title="Certificados A1"
        subtitle="Certificados digitais usados para autenticação na SEFAZ/Prefeituras"
        action={
          <button onClick={() => setUploadOpen(true)} disabled={!companyId}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition disabled:opacity-50 disabled:cursor-not-allowed">
            <Upload className="w-4 h-4" /> Fazer upload de certificado
          </button>
        }
      />

      <div className="bg-white border border-stone-200 rounded-sm p-4 mb-6">
        <Field label="Empresa">
          <Select value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={user?.profile === 'MANAGER'}>
            <option value="">Selecione...</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>

      {/* Alerta de validade do certificado ativo */}
      {hasActive && (() => {
        const days = daysUntilExpiration(activeCert.valid_to);
        if (days < 0) {
          return (
            <div className="bg-red-50 border border-red-300 rounded-sm p-4 mb-6 flex items-start gap-3">
              <ShieldX className="w-6 h-6 text-red-700 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-red-900 mb-1">Certificado EXPIRADO há {Math.abs(days)} dias</h3>
                <p className="text-sm text-red-800">As consultas vão falhar até você fazer upload de um novo certificado válido.</p>
              </div>
            </div>
          );
        }
        if (days <= 30) {
          return (
            <div className="bg-amber-50 border border-amber-300 rounded-sm p-4 mb-6 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-700 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-amber-900 mb-1">Certificado expira em {days} dias</h3>
                <p className="text-sm text-amber-800">Recomendamos providenciar a renovação o quanto antes para evitar interrupção do serviço.</p>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {!hasActive && certs.length === 0 && companyId && (
        <div className="bg-white border border-stone-200 rounded-sm p-12 text-center">
          <Key className="w-12 h-12 mx-auto text-stone-300 mb-4" strokeWidth={1.2} />
          <h3 className="font-display text-xl mb-2">Nenhum certificado cadastrado</h3>
          <p className="text-stone-600 mb-6">Faça upload do certificado A1 (.pfx) da empresa para começar a baixar notas fiscais.</p>
          <button onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-stone-100 text-sm rounded-sm hover:bg-ink/90 transition">
            <Upload className="w-4 h-4" /> Fazer upload do certificado
          </button>
        </div>
      )}

      {loading && <div className="text-center text-stone-500 py-8">Carregando...</div>}

      {certs.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Titular</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">CNPJ</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Validade</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Emissor</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Status</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-stone-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {certs.map(c => {
                  const days = daysUntilExpiration(c.valid_to);
                  const StatusIcon = statusIcons[c.status];
                  return (
                    <tr key={c.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.holder_name}</div>
                        {c.notes && <div className="text-xs text-stone-500 mt-0.5">{c.notes}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{formatDocument(c.cnpj)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-stone-700">
                          <Calendar className="w-3.5 h-3.5 text-stone-400" />
                          {formatDate(c.valid_to)}
                        </div>
                        {c.status === 'ACTIVE' && (
                          <div className={`text-xs mt-0.5 ${days < 0 ? 'text-red-600' : days <= 30 ? 'text-amber-600' : 'text-stone-500'}`}>
                            {days < 0 ? `expirado há ${Math.abs(days)}d` : days === 0 ? 'expira hoje' : `${days}d restantes`}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-700 text-xs">{c.issuer || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-sm uppercase tracking-wider ${certificateStatusColors[c.status]}`}>
                          <StatusIcon className="w-3 h-3" />
                          {certificateStatusLabels[c.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {c.status === 'ACTIVE' && (
                          <button onClick={async () => {
                            try {
                              await api.post(`/fiscal/certificates/${c.id}/sync-provider`);
                              await reload();
                            } catch (err: any) {
                              alert(err?.response?.data?.message ?? 'Erro ao sincronizar com provedor.');
                            }
                          }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-sm border transition mr-1 ${
                              c.uploaded_to_provider_at
                                ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                                : 'text-sky-700 bg-sky-50 hover:bg-sky-100 border-sky-200'
                            }`}
                            title={c.uploaded_to_provider_at ? 'Re-enviar certificado ao provedor (atualiza flags)' : 'Enviar este certificado ao provedor'}>
                            {c.uploaded_to_provider_at ? '✓ Re-sincronizar' : '⇅ Sincronizar com provedor'}
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(c)}
                          className="p-1.5 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-sm">
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
      )}

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload de certificado A1" size="md">
        <UploadModal companyId={companyId} onUploaded={handleUploaded} onCancel={() => setUploadOpen(false)} />
      </Modal>

      <ConfirmDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        entityName={deleteTarget?.holder_name}
        entityLabel="o certificado"
      />
    </div>
  );
}
