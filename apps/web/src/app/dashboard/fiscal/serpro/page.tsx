'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Lock, Unlock, RefreshCw, Activity, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageHeader, Field, Input, PrimaryButton, SecondaryButton } from '@/components/ui';

interface ProcuradorStatus {
  connected: boolean;
  contratante_cnpj?: string;
  expires_at?: string;
  remaining_minutes?: number;
}

export default function SerproProcuradorPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ProcuradorStatus | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthResult, setHealthResult] = useState<any>(null);
  const [procBusy, setProcBusy] = useState(false);
  const [procResult, setProcResult] = useState<any>(null);

  const reload = async () => {
    try {
      const r = await api.get('/serpro/procurador/status');
      setStatus(r.data);
    } catch (err: any) {
      setStatus({ connected: false });
    }
  };
  useEffect(() => { reload(); }, []);

  const conectar = async () => {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const r = await api.post('/serpro/procurador/autenticar', { password: password || undefined });
      setSuccess(`Procurador conectado. JWT válido até ${new Date(r.data.expires_at).toLocaleString('pt-BR')}.`);
      setPassword('');
      await reload();
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message);
    } finally { setBusy(false); }
  };

  const desconectar = async () => {
    setBusy(true); setError(null); setSuccess(null);
    try { await api.post('/serpro/procurador/desconectar'); await reload(); }
    catch (err: any) { setError(err.response?.data?.message ?? err.message); }
    finally { setBusy(false); }
  };

  const listarProcuracoes = async () => {
    setProcBusy(true); setProcResult(null);
    try {
      const r = await api.get('/serpro/procuracoes');
      setProcResult(r.data);
    } catch (err: any) {
      setProcResult({ error: err.response?.data?.message ?? err.message });
    } finally { setProcBusy(false); }
  };

  const healthCheck = async () => {
    setHealthBusy(true); setHealthResult(null);
    try {
      const r = await api.get('/serpro/health');
      setHealthResult(r.data);
    } catch (err: any) {
      setHealthResult({ error: err.response?.data?.message ?? err.message });
    } finally { setHealthBusy(false); }
  };

  if (user?.profile !== 'ADMIN') {
    return <div className="bg-white p-8 border border-stone-200 rounded-sm text-center text-stone-600">Apenas ADMIN pode gerenciar a integração Serpro.</div>;
  }

  const isConnected = status?.connected;

  return (
    <div>
      <PageHeader
        title="Procurador eCAC · Serpro"
        subtitle="Integra Contador"
      />

      {/* Card status */}
      <div className={`rounded-sm border-l-4 ${isConnected ? 'border-emerald-500 bg-emerald-50' : 'border-stone-400 bg-stone-50'} border border-stone-200 p-6 mb-6`}>
        <div className="flex items-start gap-4">
          {isConnected ? <ShieldCheck className="w-10 h-10 text-emerald-600 flex-shrink-0" /> : <ShieldAlert className="w-10 h-10 text-stone-500 flex-shrink-0" />}
          <div className="flex-1">
            <div className="font-display text-lg">
              {isConnected ? 'Conectado como procurador' : 'Desconectado'}
            </div>
            {isConnected ? (
              <div className="text-sm text-stone-700 mt-1 space-y-1">
                <div>CNPJ contratante: <span className="font-mono">{status?.contratante_cnpj}</span></div>
                <div>JWT válido até: <span className="font-mono">{status?.expires_at && new Date(status.expires_at).toLocaleString('pt-BR')}</span></div>
                <div className="text-xs text-stone-500">Restam ~{status?.remaining_minutes} min. O Serpro permite usar este token para consultar dados de qualquer cliente que tenha procuração eCAC para a Valentim Contabilidade.</div>
              </div>
            ) : (
              <div className="text-sm text-stone-600 mt-1">
                Para consultar dados das casas de apostas no Integra Contador (DCTFWeb, SITFIS, PGDAS-D, eSocial…), conecte-se primeiro como procurador. O sistema vai assinar um termo XML com o certificado A1 do escritório e obter um JWT do Serpro válido por ~12h.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card conexão */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <h3 className="font-display text-lg mb-4 flex items-center gap-2">
          {isConnected ? <Unlock className="w-5 h-5 text-emerald-600" /> : <Lock className="w-5 h-5 text-stone-500" />}
          {isConnected ? 'Sessão ativa' : 'Conectar como procurador'}
        </h3>

        {!isConnected && (
          <div className="space-y-4">
            <Field label="Senha do certificado A1 do escritório">
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="(deixe vazio se já configurou OFFICE_PFX_PASSWORD no .env)" />
            </Field>
            <div className="text-xs text-stone-500 -mt-2">
              A senha não é gravada — só usada em memória para descriptografar o PFX e assinar o termo. Se preferir,
              configure <code className="px-1 bg-stone-100 rounded">OFFICE_PFX_PASSWORD</code> no <code className="px-1 bg-stone-100 rounded">.env</code> e renove a sessão automaticamente.
            </div>

            <div className="flex gap-3">
              <PrimaryButton onClick={conectar} disabled={busy}>
                <ShieldCheck className="w-4 h-4" />
                {busy ? 'Conectando…' : 'Conectar agora'}
              </PrimaryButton>
              <SecondaryButton onClick={reload} disabled={busy} type="button">
                <RefreshCw className="w-4 h-4 inline mr-2" /> Atualizar status
              </SecondaryButton>
            </div>
          </div>
        )}

        {isConnected && (
          <div className="flex gap-3">
            <PrimaryButton onClick={conectar} disabled={busy}>
              <RefreshCw className="w-4 h-4" /> Renovar JWT
            </PrimaryButton>
            <SecondaryButton onClick={desconectar} disabled={busy} className="!text-red-600 hover:!bg-red-50">
              <Lock className="w-4 h-4 inline mr-2" /> Desconectar
            </SecondaryButton>
          </div>
        )}

        {error && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">{error}</div>}
        {success && <div className="mt-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-sm">{success}</div>}
      </div>

      {/* Card procurações */}
      <div className="bg-white border border-stone-200 rounded-sm p-6 mb-6">
        <h3 className="font-display text-lg mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-stone-500" /> Procurações eCAC ativas
        </h3>
        <p className="text-sm text-stone-600 mb-4">
          Lista todos os CNPJs que outorgaram procuração eletrônica eCAC para o escritório.
          Útil pra confirmar que cada cliente cadastrado já está com a procuração ativa antes de tentar consultar.
        </p>
        <SecondaryButton onClick={listarProcuracoes} disabled={procBusy} type="button">
          <Users className="w-4 h-4 inline mr-2" />
          {procBusy ? 'Consultando…' : 'Listar procurações outorgadas'}
        </SecondaryButton>
        {procResult && (
          <pre className="mt-4 text-xs bg-stone-50 border border-stone-200 p-3 rounded-sm overflow-auto max-h-96">
{JSON.stringify(procResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Card health-check */}
      <div className="bg-white border border-stone-200 rounded-sm p-6">
        <h3 className="font-display text-lg mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-stone-500" /> Diagnóstico Serpro
        </h3>
        <p className="text-sm text-stone-600 mb-4">
          Testa o OAuth2 (Consumer Key/Secret) sem precisar do procurador. Útil para confirmar que o contrato está ativo.
        </p>
        <div className="flex gap-3 mb-4">
          <SecondaryButton onClick={healthCheck} disabled={healthBusy} type="button">
            <Activity className="w-4 h-4 inline mr-2" />
            {healthBusy ? 'Testando…' : 'Health-check'}
          </SecondaryButton>
        </div>
        {healthResult && (
          <pre className="text-xs bg-stone-50 border border-stone-200 p-3 rounded-sm overflow-auto max-h-60">
{JSON.stringify(healthResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Documentação */}
      <div className="mt-8 text-xs text-stone-500 leading-relaxed">
        <strong>Como funciona:</strong> ao conectar, o ContBet (1) carrega o A1 da empresa marcada como
        “escritório contábil”, (2) converte o PFX para PEM (cert + chave) com node-forge para contornar
        cifras legadas dos PFX brasileiros, (3) abre uma conexão <strong>mTLS</strong> com
        <code className="px-1 bg-stone-100 rounded mx-1">autenticacao.sapi.serpro.gov.br/authenticate</code>
        enviando Basic auth (Consumer Key/Secret) + header <code className="px-1 bg-stone-100 rounded">Role-Type: TERCEIROS</code>,
        e (4) recebe <code className="px-1 bg-stone-100 rounded">access_token</code> + <code className="px-1 bg-stone-100 rounded">jwt_token</code>.
        Os dois são injetados em toda chamada subsequente ao Integra Contador. Cada cliente precisa ter
        outorgado <strong>procuração eletrônica eCAC</strong> para o CNPJ do escritório (uma vez, validade até 5 anos).
      </div>
    </div>
  );
}
