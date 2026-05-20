import axios, { AxiosInstance } from 'axios';

/**
 * Adapter para integração com a API do PlugNotas.
 *
 * Documentação oficial: https://docs.plugnotas.com.br
 * SDK PHP de referência: https://github.com/tecnospeed/plugnotas-php
 *
 * Endpoints alinhados ao SDK oficial (set/2024):
 * - POST /empresa                          — Cadastra a empresa no PlugNotas
 * - POST /certificado                      — Upload de certificado A1 (multipart)
 * - GET  /certificado                      — Lista certificados ativos
 * - PUT  /certificado/:id                  — Atualiza certificado existente
 * - POST /nfse                             — Emite NFSe (body = ARRAY de notas)
 * - GET  /nfse/:id                         — Consulta NFSe por ID
 * - GET  /nfse/consultar/:idIntegracao/:cnpj — Consulta por idempotência
 * - POST /nfse/cancelar/:id                — Cancela NFSe
 * - GET  /nfse/cancelar/status/:id         — Status do cancelamento
 * - GET  /nfse/xml/:id                     — Download XML autorizado
 * - GET  /nfse/pdf/:id                     — Download DANFSe PDF
 *
 * Autenticação: header `x-api-key` com a chave fornecida pelo cliente.
 *
 * NFSe TOMADAS (NFSe entrada — fornecedores emitiram contra a empresa):
 *   Não há endpoint público no SDK PHP. Esse é um produto separado da
 *   Tecnospeed (captador de NFSe). O método `fetchIncomingNfse` abaixo é um
 *   placeholder com endpoint experimental; precisa ser confirmado com o
 *   suporte da Plugnotas conforme o plano contratado.
 */

export interface FiscalProviderAdapter {
  /** Cadastra empresa no provedor (necessário antes de fazer upload de certificado) */
  registerCompany(input: RegisterCompanyInput): Promise<{ id: string }>;

  /** Faz upload do certificado A1 (.pfx) no provedor */
  uploadCertificate(input: UploadCertificateInput): Promise<{ id: string }>;

  /** Consulta NFSe consumidas pela empresa (notas recebidas) — depende de produto separado da Plugnotas */
  fetchIncomingNfse(input: FetchNfseInput): Promise<NfseDocument[]>;

  /** Baixa XML de um documento (autorizado) */
  fetchDocumentXml(documentId: string): Promise<string>;

  /** Baixa PDF (DANFSe) de um documento autorizado */
  fetchDocumentPdf?(documentId: string): Promise<Buffer>;

  /** Emite uma NFSe (saída — a empresa é prestadora) */
  issueNfse(input: IssueNfseInput): Promise<IssueNfseResult>;

  /** Consulta uma NFSe pelo ID retornado na emissão */
  getNfse?(documentId: string): Promise<IssueNfseResult>;

  /** Cancela uma NFSe autorizada (assíncrono — use getCancellationStatus para polling) */
  cancelNfse?(documentId: string, motivo?: string): Promise<{ protocolo: string; status: string }>;

  /** Consulta o status de um pedido de cancelamento */
  getCancellationStatus?(documentId: string): Promise<{ status: string; raw: any }>;

  /** Health-check leve — valida só auth, sem efeitos colaterais. */
  ping?(): Promise<{ ok: boolean; message?: string }>;

  /** Consulta NFe (modelo 55) recebidas pela empresa (entradas — fornecedores). Opcional. */
  fetchIncomingNfe?(input: FetchNfseInput): Promise<NfeDocument[]>;
}

export interface NfeDocument {
  provider_id: string;
  chave_acesso: string;       // 44 dígitos
  numero_nota: string | null;
  serie: string | null;
  data_emissao: Date;

  emitente_cnpj: string;
  emitente_nome: string;
  emitente_ie: string | null;

  destinatario_cnpj: string;
  destinatario_nome: string | null;

  valor_total: number;        // em reais
  valor_produtos: number;
  valor_icms: number;
  valor_ipi: number;
  valor_pis: number;
  valor_cofins: number;

  cfop: string | null;
  natureza_operacao: string | null;

  status: 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA' | 'INUTILIZADA';
  protocolo: string | null;
  xml: string | null;         // resumo (resNFe) ou XML completo, conforme provedor
  raw: any;
}

export interface IssueNfseInput {
  prestador_cnpj: string;
  prestador_inscricao_municipal?: string;
  /** Tomador do serviço — se ausente, usa o próprio prestador (auto-emissão) */
  tomador_cnpj?: string;
  tomador_razao_social?: string;
  tomador_endereco?: {
    logradouro?: string; numero?: string; bairro?: string;
    municipio?: string; uf?: string; cep?: string;
    codigo_municipio?: string;
  };
  /** Código do serviço (ex.: "17.06" — Lista LC 116/03 ou da prefeitura) */
  codigo_servico: string;
  cnae?: string;
  descricao: string;
  valor_servicos: number;          // em reais
  iss_aliquota?: number;            // % (ex.: 5.0)
  iss_retido?: boolean;
  data_emissao?: Date;
  /** Identificador interno (idempotência) */
  id_integracao?: string;
}

export interface IssueNfseResult {
  provider_id: string;
  numero_nfse: string | null;
  serie: string | null;
  status: 'AUTORIZADA' | 'PROCESSANDO' | 'REJEITADA' | 'PENDENTE';
  protocolo: string | null;
  pdf_url: string | null;
  xml: string | null;
  raw: any;
}

export interface RegisterCompanyInput {
  cnpj: string;
  razao_social: string;
  endereco?: {
    logradouro?: string;
    numero?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
  };
  inscricao_municipal?: string;
  email?: string;
  telefone?: string;
}

export interface UploadCertificateInput {
  cnpj: string;
  pfx_base64: string;
  password: string;
}

export interface FetchNfseInput {
  cnpj: string;
  start_date: Date;  // data inicial da consulta
  end_date: Date;    // data final
}

export interface NfseDocument {
  provider_id: string;       // ID no PlugNotas
  numero_nota: string;
  serie: string | null;
  chave_acesso: string | null;
  data_emissao: Date;

  prestador_cnpj: string;
  prestador_nome: string;
  prestador_municipio_codigo: string | null;

  tomador_cnpj: string | null;
  tomador_nome: string | null;

  valor_total: number;        // em reais (não centavos)
  valor_servicos: number;
  iss_valor: number;
  iss_aliquota: number | null;
  irrf_valor: number;
  inss_valor: number;
  pis_valor: number;
  cofins_valor: number;
  csll_valor: number;

  descricao: string | null;
  codigo_servico: string | null;
  cnae: string | null;

  status: 'AUTORIZADA' | 'CANCELADA' | 'PENDENTE' | 'REJEITADA';

  xml: string | null;          // XML completo (se disponível)
  pdf_url: string | null;      // URL do DANFSe
  raw: any;                    // Resposta raw para debug
}

export class PlugNotasAdapter implements FiscalProviderAdapter {
  private http: AxiosInstance;

  constructor(apiKey: string, sandbox: boolean = false) {
    const baseURL = sandbox
      ? 'https://api.sandbox.plugnotas.com.br'
      : 'https://api.plugnotas.com.br';

    this.http = axios.create({
      baseURL,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async ping(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.http.get('/empresa/00000000000000', { validateStatus: () => true });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `API key rejeitada (HTTP ${res.status})` };
      }
      return { ok: true, message: `Auth OK (HTTP ${res.status})` };
    } catch (err: any) {
      return { ok: false, message: `Falha de rede: ${err.message}` };
    }
  }

  async registerCompany(input: RegisterCompanyInput): Promise<{ id: string }> {
    try {
      const payload = {
        cpfCnpj: input.cnpj,
        razaoSocial: input.razao_social,
        inscricaoMunicipal: input.inscricao_municipal,
        email: input.email,
        telefone: input.telefone,
        endereco: input.endereco ? {
          logradouro: input.endereco.logradouro,
          numero: input.endereco.numero,
          bairro: input.endereco.bairro,
          municipio: input.endereco.municipio,
          uf: input.endereco.uf,
          cep: input.endereco.cep?.replace(/\D/g, ''),
        } : undefined,
      };

      const res = await this.http.post('/empresa', payload);
      return { id: res.data?.id || res.data?._id || input.cnpj };
    } catch (err: any) {
      // Se já existe, é OK
      if (err.response?.status === 409 || err.response?.data?.message?.includes('exist')) {
        return { id: input.cnpj };
      }
      throw this.translateError(err);
    }
  }

  async uploadCertificate(input: UploadCertificateInput): Promise<{ id: string }> {
    try {
      // SDK PHP oficial usa POST /certificado (multipart) sem path-param de CNPJ.
      // O CNPJ do titular vai como campo do form (chave "cpfCnpj").
      const FormData = require('form-data');
      const form = new FormData();
      form.append('arquivo', Buffer.from(input.pfx_base64, 'base64'), {
        filename: `${this.cleanCnpj(input.cnpj)}.pfx`,
        contentType: 'application/x-pkcs12',
      });
      form.append('senha', input.password);
      form.append('cpfCnpj', this.cleanCnpj(input.cnpj));

      const res = await this.http.post('/certificado', form, {
        headers: form.getHeaders(),
      });
      return { id: res.data?.id || res.data?._id || input.cnpj };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /**
   * ⚠️  PLACEHOLDER — captação de NFSe entrada (NFSe Tomadas).
   *
   * O SDK PHP oficial da Plugnotas NÃO expõe esse endpoint, e a documentação
   * pública também não cobre. A captação de NFSe Tomadas geralmente é um
   * produto separado da Tecnospeed (NFSe Nacional / Capturador de NFSe).
   *
   * AÇÃO NECESSÁRIA antes de usar em produção:
   *  1. Confirmar com o suporte Plugnotas se o plano contratado inclui
   *     captação de NFSe Tomadas.
   *  2. Pegar o caminho exato do endpoint (provavelmente algo como
   *     `/nfse-nacional/tomadas` ou `/nfse/tomadas`) e formato dos parâmetros.
   *  3. Ajustar a URL e o parser de resposta abaixo.
   *
   * Caminho atual é uma TENTATIVA — vai retornar 404 na maioria das contas.
   */
  async fetchIncomingNfse(input: FetchNfseInput): Promise<NfseDocument[]> {
    try {
      const params = {
        dataInicial: this.formatDate(input.start_date),
        dataFinal: this.formatDate(input.end_date),
      };

      const res = await this.http.get(`/nfse/consulta/cnpj/${input.cnpj}`, { params });

      const items: any[] = res.data?.data || res.data?.documentos || res.data || [];
      return items.map(item => this.mapNfse(item));
    } catch (err: any) {
      // Sandbox/conta nova pode retornar 404 sem dados — ou o endpoint pode
      // não existir nesse plano. Retornamos lista vazia e logamos para
      // que o usuário valide com a Plugnotas.
      if (err.response?.status === 404) {
        console.warn('[PlugNotas] fetchIncomingNfse retornou 404 — endpoint pode não estar disponível no plano contratado. Confirmar com o suporte Plugnotas.');
        return [];
      }
      throw this.translateError(err);
    }
  }

  async issueNfse(input: IssueNfseInput): Promise<IssueNfseResult> {
    try {
      const idIntegracao = input.id_integracao || `nfse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dataEmissao = (input.data_emissao ?? new Date()).toISOString();

      const payload: any = {
        idIntegracao,
        prestador: { cpfCnpj: this.cleanCnpj(input.prestador_cnpj) },
        tomador: input.tomador_cnpj
          ? {
              cpfCnpj: this.cleanCnpj(input.tomador_cnpj),
              razaoSocial: input.tomador_razao_social,
              endereco: input.tomador_endereco ? {
                logradouro: input.tomador_endereco.logradouro,
                numero: input.tomador_endereco.numero,
                bairro: input.tomador_endereco.bairro,
                municipio: input.tomador_endereco.municipio,
                uf: input.tomador_endereco.uf,
                cep: input.tomador_endereco.cep?.replace(/\D/g, ''),
                codigoMunicipio: input.tomador_endereco.codigo_municipio,
              } : undefined,
            }
          : undefined,
        // servico é ARRAY (NFSe pode ter múltiplos itens). iss e valor são
        // blocos SEPARADOS — `valor.servico` (singular) e `iss` no mesmo nível.
        // tipoTributacao=0 (operação normal), exigibilidade=1 (exigível).
        // Validado no sandbox em 2026-04-27.
        servico: [{
          codigo: input.codigo_servico,
          discriminacao: input.descricao,
          cnae: input.cnae,
          iss: {
            aliquota: input.iss_aliquota ?? 5.0,
            tipoTributacao: 0,
            exigibilidade: 1,
          },
          valor: {
            servico: input.valor_servicos,
            issRetido: input.iss_retido ?? false,
          },
        }],
        dataEmissao,
      };
      if (input.prestador_inscricao_municipal) {
        payload.prestador.inscricaoMunicipal = input.prestador_inscricao_municipal;
      }

      // Plugnotas espera body como ARRAY de notas (mesmo que seja só uma).
      // Confirme no SDK PHP: $communication->send('POST', '/nfse', [$this->toArray(true)])
      const res = await this.http.post('/nfse', [payload]);
      // Resposta validada no sandbox: { documents: [{idIntegracao, prestador, id}], message, protocol }
      const responseData = res.data;
      const doc = Array.isArray(responseData?.documents) ? responseData.documents[0]
                : Array.isArray(responseData?.data) ? responseData.data[0]
                : Array.isArray(responseData) ? responseData[0]
                : responseData;
      return {
        provider_id: doc?.id || doc?._id || idIntegracao,
        numero_nfse: doc?.numero || doc?.numeroNfse || null,
        serie: doc?.serie ?? null,
        status: this.mapIssueStatus(doc?.status || doc?.situacao || responseData?.message),
        protocolo: responseData?.protocol ?? doc?.protocolo ?? null,
        pdf_url: doc?.pdfUrl || doc?.linkDownload || null,
        xml: doc?.xml ?? null,
        raw: responseData,
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  private mapIssueStatus(raw: string | undefined | null): IssueNfseResult['status'] {
    if (!raw) return 'PENDENTE';
    const s = raw.toString().toUpperCase();
    if (s.includes('AUTORIZ') || s === 'CONCLUIDO') return 'AUTORIZADA';
    // "Nota(as) em processamento" — resposta do POST /nfse no sandbox
    if (s.includes('PROCESS')) return 'PROCESSANDO';
    if (s.includes('REJEIT') || s.includes('ERRO')) return 'REJEITADA';
    return 'PENDENTE';
  }

  async fetchDocumentXml(documentId: string): Promise<string> {
    try {
      // Caminho correto conforme SDK PHP oficial: /nfse/xml/:id (não /nfse/:id/xml)
      const res = await this.http.get(`/nfse/xml/${documentId}`, {
        responseType: 'text',
      });
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  async fetchDocumentPdf(documentId: string): Promise<Buffer> {
    try {
      const res = await this.http.get(`/nfse/pdf/${documentId}`, {
        responseType: 'arraybuffer',
      });
      return Buffer.from(res.data);
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /** Consulta NFSe por ID retornado na emissão. */
  async getNfse(documentId: string): Promise<IssueNfseResult> {
    try {
      const res = await this.http.get(`/nfse/${documentId}`);
      const data = res.data?.data || res.data;
      return {
        provider_id: data?.id || data?._id || documentId,
        numero_nfse: data?.numero || data?.numeroNfse || null,
        serie: data?.serie ?? null,
        status: this.mapIssueStatus(data?.status || data?.situacao),
        protocolo: data?.protocolo ?? null,
        pdf_url: data?.pdfUrl || data?.linkDownload || null,
        xml: data?.xml ?? null,
        raw: data,
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /**
   * Cancela uma NFSe autorizada. O cancelamento é ASSÍNCRONO — a Plugnotas
   * retorna imediatamente um protocolo, mas o status final precisa ser
   * acompanhado via `getCancellationStatus`.
   */
  async cancelNfse(documentId: string, motivo?: string): Promise<{ protocolo: string; status: string }> {
    try {
      const payload = motivo ? { motivo } : null;
      const res = await this.http.post(`/nfse/cancelar/${documentId}`, payload);
      const data = res.data?.data || res.data;
      return {
        protocolo: data?.protocolo || data?.id || documentId,
        status: data?.status || data?.situacao || 'PROCESSANDO',
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /** Consulta status do cancelamento (polling). */
  async getCancellationStatus(documentId: string): Promise<{ status: string; raw: any }> {
    try {
      const res = await this.http.get(`/nfse/cancelar/status/${documentId}`);
      const data = res.data?.data || res.data;
      return {
        status: data?.status || data?.situacao || 'DESCONHECIDO',
        raw: data,
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  private mapNfse(raw: any): NfseDocument {
    // Mapeamento defensivo: tenta múltiplos nomes de campos
    return {
      provider_id: raw.id || raw._id || raw.idIntegracao || '',
      numero_nota: raw.numero || raw.numeroNota || raw.numeroNfse || '',
      serie: raw.serie || null,
      chave_acesso: raw.chaveAcesso || raw.chave || null,
      data_emissao: new Date(raw.dataEmissao || raw.dataEmissaoNfse || raw.competencia),

      prestador_cnpj: this.cleanCnpj(raw.prestador?.cpfCnpj || raw.prestador?.cnpj || ''),
      prestador_nome: raw.prestador?.razaoSocial || raw.prestador?.nome || '',
      prestador_municipio_codigo: raw.prestador?.endereco?.codigoMunicipio?.toString() || null,

      tomador_cnpj: this.cleanCnpj(raw.tomador?.cpfCnpj || raw.tomador?.cnpj || ''),
      tomador_nome: raw.tomador?.razaoSocial || raw.tomador?.nome || null,

      valor_total: parseFloat(raw.servico?.valor?.servicos || raw.valorTotal || raw.valor || 0),
      valor_servicos: parseFloat(raw.servico?.valor?.servicos || raw.valorServicos || 0),
      iss_valor: parseFloat(raw.servico?.valor?.iss || raw.valorIss || 0),
      iss_aliquota: raw.servico?.valor?.aliquota ? parseFloat(raw.servico.valor.aliquota) : null,
      irrf_valor: parseFloat(raw.servico?.valor?.ir || raw.valorIr || 0),
      inss_valor: parseFloat(raw.servico?.valor?.inss || 0),
      pis_valor: parseFloat(raw.servico?.valor?.pis || 0),
      cofins_valor: parseFloat(raw.servico?.valor?.cofins || 0),
      csll_valor: parseFloat(raw.servico?.valor?.csll || 0),

      descricao: raw.servico?.discriminacao || raw.descricao || null,
      codigo_servico: raw.servico?.codigo || raw.codigoServico || null,
      cnae: raw.servico?.cnae || null,

      status: this.mapStatus(raw.status || raw.situacao),

      xml: raw.xml || null,
      pdf_url: raw.pdfUrl || raw.linkDownload || null,
      raw,
    };
  }

  private mapStatus(raw: string): NfseDocument['status'] {
    if (!raw) return 'PENDENTE';
    const s = raw.toUpperCase();
    if (s.includes('AUTORIZ') || s === 'CONCLUIDO') return 'AUTORIZADA';
    if (s.includes('CANCEL')) return 'CANCELADA';
    if (s.includes('REJEIT') || s.includes('ERRO')) return 'REJEITADA';
    return 'PENDENTE';
  }

  private cleanCnpj(s: string): string {
    return (s || '').replace(/\D/g, '');
  }

  private formatDate(d: Date): string {
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private translateError(err: any): Error {
    if (err.response) {
      const msg = err.response.data?.message
        || err.response.data?.erro
        || err.response.data?.error
        || `HTTP ${err.response.status}`;
      return new Error(`PlugNotas: ${msg}`);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return new Error('Não foi possível conectar ao PlugNotas. Verifique sua internet.');
    }
    return new Error(`PlugNotas: ${err.message || 'erro desconhecido'}`);
  }
}

/**
 * Factory para criar adapter do provedor configurado.
 * Quando outros provedores forem adicionados (Focus NFe, NFE.io), basta
 * adicionar o switch case aqui.
 */
export function createProviderAdapter(
  type: string,
  apiKey: string,
  sandbox: boolean = false,
): FiscalProviderAdapter {
  switch (type) {
    case 'PLUGNOTAS':
      return new PlugNotasAdapter(apiKey, sandbox);
    case 'FOCUS_NFE': {
      const { FocusNfeAdapter } = require('./focus-nfe.adapter');
      return new FocusNfeAdapter(apiKey, sandbox);
    }
    case 'ARQUIVEI': {
      // Qive (antiga Arquivei) — captador de NFSe Tomadas Municipais
      const { QiveAdapter } = require('./qive.adapter');
      return new QiveAdapter(apiKey, sandbox);
    }
    // case 'NFE_IO':
    //   return new NfeIoAdapter(apiKey, sandbox);
    default:
      throw new Error(`Provedor não suportado: ${type}`);
  }
}
