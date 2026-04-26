import axios, { AxiosInstance } from 'axios';

/**
 * Adapter para integração com a API do PlugNotas.
 *
 * Documentação oficial: https://docs.plugnotas.com.br
 *
 * Endpoints principais usados:
 * - POST /empresa                — Cadastra a empresa no PlugNotas
 * - POST /empresa/{cnpj}/certificado — Faz upload do certificado A1
 * - GET /nfse/consulta/cnpj/{cnpj} — Consulta NFSe consumidas pela empresa
 * - GET /nfse/{id}/xml           — Baixa XML de uma NFSe
 * - GET /nfse/{id}/pdf           — Baixa PDF (DANFSe)
 *
 * Autenticação: header `x-api-key` com a chave fornecida pelo cliente.
 *
 * IMPORTANTE: este código foi construído a partir da documentação pública.
 * Pode haver pequenos ajustes necessários quando testado contra a API real,
 * dependendo de mudanças na documentação ou de detalhes específicos da conta.
 */

export interface FiscalProviderAdapter {
  /** Cadastra empresa no provedor (necessário antes de fazer upload de certificado) */
  registerCompany(input: RegisterCompanyInput): Promise<{ id: string }>;

  /** Faz upload do certificado A1 (.pfx) no provedor */
  uploadCertificate(input: UploadCertificateInput): Promise<{ id: string }>;

  /** Consulta NFSe consumidas pela empresa (notas recebidas) */
  fetchIncomingNfse(input: FetchNfseInput): Promise<NfseDocument[]>;

  /** Baixa XML de um documento */
  fetchDocumentXml(documentId: string): Promise<string>;

  /** Emite uma NFSe (saída — a empresa é prestadora) */
  issueNfse(input: IssueNfseInput): Promise<IssueNfseResult>;
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
      // PlugNotas espera multipart/form-data para upload de certificado
      const FormData = require('form-data');
      const form = new FormData();
      form.append('arquivo', Buffer.from(input.pfx_base64, 'base64'), {
        filename: `${input.cnpj}.pfx`,
        contentType: 'application/x-pkcs12',
      });
      form.append('senha', input.password);

      const res = await this.http.post(`/empresa/${input.cnpj}/certificado`, form, {
        headers: form.getHeaders(),
      });
      return { id: res.data?.id || input.cnpj };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

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
      // Sandbox/conta nova pode retornar 404 sem dados
      if (err.response?.status === 404) return [];
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
        servico: {
          codigo: input.codigo_servico,
          discriminacao: input.descricao,
          cnae: input.cnae,
          valor: {
            servicos: input.valor_servicos,
            aliquota: input.iss_aliquota,
            issRetido: input.iss_retido ?? false,
          },
        },
        dataEmissao,
      };
      if (input.prestador_inscricao_municipal) {
        payload.prestador.inscricaoMunicipal = input.prestador_inscricao_municipal;
      }

      const res = await this.http.post('/nfse', payload);
      const data = res.data?.data || res.data;
      return {
        provider_id: data?.id || data?._id || idIntegracao,
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

  private mapIssueStatus(raw: string | undefined): IssueNfseResult['status'] {
    if (!raw) return 'PENDENTE';
    const s = raw.toUpperCase();
    if (s.includes('AUTORIZ') || s === 'CONCLUIDO') return 'AUTORIZADA';
    if (s.includes('PROCESS')) return 'PROCESSANDO';
    if (s.includes('REJEIT') || s.includes('ERRO')) return 'REJEITADA';
    return 'PENDENTE';
  }

  async fetchDocumentXml(documentId: string): Promise<string> {
    try {
      const res = await this.http.get(`/nfse/${documentId}/xml`, {
        responseType: 'text',
      });
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
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
    // case 'FOCUS_NFE':
    //   return new FocusNfeAdapter(apiKey, sandbox);
    // case 'NFE_IO':
    //   return new NfeIoAdapter(apiKey, sandbox);
    default:
      throw new Error(`Provedor não suportado: ${type}`);
  }
}
