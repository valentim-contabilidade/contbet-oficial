import axios, { AxiosInstance } from 'axios';
import {
  FiscalProviderAdapter,
  IssueNfseInput,
  IssueNfseResult,
  RegisterCompanyInput,
  UploadCertificateInput,
  FetchNfseInput,
  NfseDocument,
} from './plugnotas.adapter';

/**
 * Adapter para Focus NFe — provedor brasileiro líder em emissão de NFSe.
 *
 * Documentação oficial: https://focusnfe.com.br/doc/
 * Ambientes:
 *   - Homologação: https://homologacao.focusnfe.com.br
 *   - Produção:    https://api.focusnfe.com.br
 *
 * Autenticação: Basic Auth com o token (login = token, senha vazia).
 *   Authorization: Basic base64(token:)
 *
 * Endpoints principais usados:
 *   - GET  /v2/empresas                              — Lista empresas cadastradas
 *   - POST /v2/empresas                              — Cadastra empresa
 *   - PUT  /v2/empresas/{cnpj}                       — Atualiza empresa
 *   - POST /v2/empresas/{cnpj}/upload_certificado    — Upload certificado A1
 *   - POST /v2/nfse?ref={ref}                        — Emite NFSe (assíncrono)
 *   - GET  /v2/nfse/{ref}                            — Consulta status da NFSe
 *   - DELETE /v2/nfse/{ref}                          — Cancela NFSe
 *
 * NFSe entrada (tomadas): a Focus tem cobertura limitada para captação
 * de NFSe entrada — depende do município. Para captação ampla, recomendamos
 * complementar com Arquivei ou upload manual.
 */
export class FocusNfeAdapter implements FiscalProviderAdapter {
  private http: AxiosInstance;
  private sandbox: boolean;

  constructor(token: string, sandbox: boolean = true) {
    this.sandbox = sandbox;
    const baseURL = sandbox
      ? (process.env.FOCUS_NFE_BASE_URL_HOMOLOG ?? 'https://homologacao.focusnfe.com.br')
      : (process.env.FOCUS_NFE_BASE_URL_PROD    ?? 'https://api.focusnfe.com.br');

    // Focus NFe usa Basic Auth com token como login (senha vazia)
    const basicAuth = Buffer.from(`${token}:`).toString('base64');

    this.http = axios.create({
      baseURL,
      timeout: 30_000,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ============= Cadastro / Empresa =============

  /**
   * No fluxo Focus NFe, a empresa **precisa estar cadastrada no painel**
   * (https://app-v2.focusnfe.com.br) antes — o POST /v2/empresas não está
   * disponível em todos os tokens (sobretudo em homologação).
   *
   * Aqui fazemos PUT /v2/empresas/{cnpj} pra ATUALIZAR uma empresa já
   * existente, ligando os flags de NFSe e NFSe Tomadas conforme o ambiente.
   * Se a empresa não existir, devolvemos um erro explicativo.
   */
  async registerCompany(input: RegisterCompanyInput): Promise<{ id: string }> {
    const cnpj = this.cleanCnpj(input.cnpj);
    const payload: any = {
      nome: input.razao_social,
      nome_fantasia: input.razao_social,
      inscricao_municipal: input.inscricao_municipal,
      email: input.email,
      telefone: input.telefone?.replace(/\D/g, ''),
      ...(input.endereco ? {
        logradouro: input.endereco.logradouro,
        numero: input.endereco.numero,
        bairro: input.endereco.bairro,
        municipio: input.endereco.municipio,
        uf: input.endereco.uf,
        cep: input.endereco.cep?.replace(/\D/g, ''),
      } : {}),
      habilita_nfse: true,
      habilita_nfsen_producao: !this.sandbox,
      habilita_nfsen_homologacao: this.sandbox,
      habilita_nfsen_recebidas_producao: !this.sandbox,
      habilita_nfsen_recebidas_homologacao: this.sandbox,
    };

    try {
      await this.http.put(`/v2/empresas/${cnpj}`, payload);
      return { id: cnpj };
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404) {
        throw new Error(
          `Empresa CNPJ ${cnpj} não está cadastrada no Focus NFe. Cadastre primeiro pelo painel ` +
          `https://app-v2.focusnfe.com.br/minhas_empresas/empresas (token específico desta empresa) e tente novamente.`,
        );
      }
      throw this.translateError(err);
    }
  }

  // ============= Certificado A1 =============

  async uploadCertificate(input: UploadCertificateInput): Promise<{ id: string }> {
    try {
      const cnpj = this.cleanCnpj(input.cnpj);
      // Focus aceita o PFX em base64 + senha em JSON
      const res = await this.http.post(`/v2/empresas/${cnpj}/upload_certificado`, {
        arquivo_base64: input.pfx_base64,
        senha: input.password,
      });
      return { id: res.data?.id || cnpj };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  // ============= Emissão NFSe =============

  async issueNfse(input: IssueNfseInput): Promise<IssueNfseResult> {
    try {
      const ref = input.id_integracao || `contbet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dataEmissao = (input.data_emissao ?? new Date()).toISOString();

      // Schema Focus NFe — NFSe (item 17.06 ou 12.13 para apostas)
      const payload: any = {
        data_emissao: dataEmissao,
        prestador: {
          cnpj: this.cleanCnpj(input.prestador_cnpj),
          inscricao_municipal: input.prestador_inscricao_municipal,
        },
        servico: {
          aliquota: input.iss_aliquota ?? 5.0,
          discriminacao: input.descricao,
          iss_retido: input.iss_retido ?? false,
          item_lista_servico: input.codigo_servico,
          codigo_tributario_municipio: input.codigo_servico,
          codigo_cnae: input.cnae,
          valor_servicos: input.valor_servicos,
        },
      };

      if (input.tomador_cnpj) {
        payload.tomador = {
          cnpj: this.cleanCnpj(input.tomador_cnpj),
          razao_social: input.tomador_razao_social,
          ...(input.tomador_endereco ? {
            endereco: {
              logradouro: input.tomador_endereco.logradouro,
              numero: input.tomador_endereco.numero,
              bairro: input.tomador_endereco.bairro,
              codigo_municipio: input.tomador_endereco.codigo_municipio,
              uf: input.tomador_endereco.uf,
              cep: input.tomador_endereco.cep?.replace(/\D/g, ''),
            },
          } : {}),
        };
      }

      // Focus emite assíncrono. POST retorna 202 com status PROCESSANDO_AUTORIZACAO
      const res = await this.http.post(`/v2/nfse?ref=${encodeURIComponent(ref)}`, payload);

      return {
        provider_id: ref,
        numero_nfse: res.data?.numero || null,
        serie: res.data?.serie ?? null,
        status: this.mapIssueStatus(res.data?.status),
        protocolo: res.data?.protocolo ?? null,
        pdf_url: res.data?.url_danfse ?? null,
        xml: null,
        raw: res.data,
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /** Consulta uma NFSe pelo ref de integração */
  async getNfse(ref: string): Promise<IssueNfseResult> {
    try {
      const res = await this.http.get(`/v2/nfse/${encodeURIComponent(ref)}`);
      return {
        provider_id: ref,
        numero_nfse: res.data?.numero ?? null,
        serie: res.data?.serie ?? null,
        status: this.mapIssueStatus(res.data?.status),
        protocolo: res.data?.protocolo ?? null,
        pdf_url: res.data?.url_danfse ?? null,
        xml: res.data?.caminho_xml_nota_fiscal ?? null,
        raw: res.data,
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /** Cancela uma NFSe autorizada */
  async cancelNfse(ref: string, motivo?: string): Promise<{ protocolo: string; status: string }> {
    try {
      const res = await this.http.delete(`/v2/nfse/${encodeURIComponent(ref)}`, {
        data: { justificativa: motivo || 'Cancelamento solicitado pelo emissor' },
      });
      return {
        protocolo: res.data?.protocolo_cancelamento || ref,
        status: res.data?.status || 'CANCELANDO',
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  /** Status do cancelamento (polling) */
  async getCancellationStatus(ref: string): Promise<{ status: string; raw: any }> {
    try {
      const res = await this.http.get(`/v2/nfse/${encodeURIComponent(ref)}`);
      return {
        status: res.data?.status_cancelamento || res.data?.status || 'DESCONHECIDO',
        raw: res.data,
      };
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  // ============= Documentos =============

  async fetchDocumentXml(ref: string): Promise<string> {
    try {
      // Focus retorna a URL do XML; precisa baixar separadamente
      const meta = await this.http.get(`/v2/nfse/${encodeURIComponent(ref)}`);
      const xmlPath = meta.data?.caminho_xml_nota_fiscal;
      if (!xmlPath) throw new Error('XML ainda não disponível.');
      const xml = await this.http.get(xmlPath, { responseType: 'text' });
      return typeof xml.data === 'string' ? xml.data : JSON.stringify(xml.data);
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  async fetchDocumentPdf(ref: string): Promise<Buffer> {
    try {
      const meta = await this.http.get(`/v2/nfse/${encodeURIComponent(ref)}`);
      const pdfPath = meta.data?.url_danfse;
      if (!pdfPath) throw new Error('PDF ainda não disponível.');
      const pdf = await this.http.get(pdfPath, { responseType: 'arraybuffer' });
      return Buffer.from(pdf.data);
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  // ============= Health-check =============

  /**
   * Valida só a autenticação (token + ambiente) sem efeitos colaterais.
   * Faz um GET em uma rota inocente. Se retornar 401/403 → token errado.
   * Qualquer outro status (200/404/422) significa auth OK.
   */
  async ping(): Promise<{ ok: boolean; message?: string }> {
    try {
      // CNPJ inexistente — esperamos 404, mas com auth válido.
      const res = await this.http.get('/v2/empresas/00000000000000', {
        validateStatus: () => true,
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Token rejeitado (HTTP ${res.status}): ${JSON.stringify(res.data).slice(0, 200)}` };
      }
      return { ok: true, message: `Auth OK (HTTP ${res.status} — esperado em ping)` };
    } catch (err: any) {
      return { ok: false, message: `Falha de rede: ${err.message}` };
    }
  }

  // ============= NFSe Tomada (entrada) — NFSe Nacional Recebidas =============

  /**
   * Lista NFSe NACIONAIS recebidas pelo CNPJ informado.
   *
   * REQUER no painel Focus (aba "Documentos Fiscais" da empresa):
   *  - "Recebimento de NFSes do ambiente nacional" ATIVADO
   *  - Ambiente NFSe Nacional - Homologação OU Produção ATIVADO conforme caso
   *
   * Endpoint: GET /v2/nfsen/recebidas (NFSe NACIONAL — modelo 105, Conv.
   * NFS-e Nacional / Lei 14.453/22).
   *
   * 404 "Nota fiscal não encontrada" = endpoint OK, sem notas no período.
   * 404 "Endpoint não encontrado" = caminho errado (não deve acontecer).
   *
   * Importante: cobre apenas NFSe Nacional. Notas municipais antigas
   * exigem captador externo (Arquivei, Tecnospeed) ou upload de XMLs.
   */
  async fetchIncomingNfse(input: FetchNfseInput): Promise<NfseDocument[]> {
    const cnpj = this.cleanCnpj(input.cnpj);
    const startStr = input.start_date.toISOString().slice(0, 10);
    const endStr = input.end_date.toISOString().slice(0, 10);

    let res;
    try {
      res = await this.http.get('/v2/nfsen/recebidas', {
        params: {
          cnpj_tomador: cnpj,
          data_inicial: startStr,
          data_final: endStr,
        },
        validateStatus: () => true,
      });
    } catch (err: any) {
      throw this.translateError(err);
    }

    // Tratamento dos 404 do Focus
    if (res.status === 404) {
      const msg = (res.data?.mensagem ?? '').toLowerCase();
      if (msg.includes('endpoint')) {
        // Caminho errado/empresa sem flag. Loga e retorna vazio.
        console.warn(`[FocusNFe] /nfsen/recebidas 404 endpoint: ${JSON.stringify(res.data)}`);
        return [];
      }
      // "Nota fiscal não encontrada" = vazio normal
      return [];
    }
    if (res.status >= 400) {
      throw this.translateError({ response: res });
    }

    const data = res.data;
    const lista: any[] = Array.isArray(data)
      ? data
      : (data?.nfses ?? data?.notas ?? data?.nfsen ?? []);

    return lista.map((raw) => this.mapNfseRecebida(raw));
  }

  private mapNfseRecebida(raw: any): NfseDocument {
    // Focus retorna campos como snake_case; convertemos para o NfseDocument.
    const valorTotal = Number(raw.valor_total ?? raw.valor_liquido_nfse ?? 0);
    const valorServicos = Number(raw.valor_servicos ?? valorTotal);
    const iss = Number(raw.valor_iss ?? raw.iss_valor ?? 0);
    return {
      provider_id: String(raw.chave_nfse ?? raw.id ?? raw.numero ?? ''),
      numero_nota: String(raw.numero ?? raw.numero_nfse ?? ''),
      serie: raw.serie ? String(raw.serie) : null,
      chave_acesso: raw.chave_nfse ?? null,
      data_emissao: raw.data_emissao ? new Date(raw.data_emissao) : new Date(),

      prestador_cnpj: this.cleanCnpj(raw.cnpj_prestador ?? raw.prestador_cnpj ?? ''),
      prestador_nome: raw.nome_prestador ?? raw.prestador_nome ?? raw.razao_social_prestador ?? '',
      prestador_municipio_codigo: raw.codigo_municipio_prestador ?? null,

      tomador_cnpj: raw.cnpj_tomador ? this.cleanCnpj(raw.cnpj_tomador) : null,
      tomador_nome: raw.nome_tomador ?? raw.razao_social_tomador ?? null,

      valor_total: valorTotal,
      valor_servicos: valorServicos,
      iss_valor: iss,
      iss_aliquota: raw.aliquota_iss != null ? Number(raw.aliquota_iss) : null,
      irrf_valor: Number(raw.valor_ir ?? raw.valor_irrf ?? 0),
      inss_valor: Number(raw.valor_inss ?? 0),
      pis_valor: Number(raw.valor_pis ?? 0),
      cofins_valor: Number(raw.valor_cofins ?? 0),
      csll_valor: Number(raw.valor_csll ?? 0),

      descricao: raw.discriminacao ?? raw.descricao_servico ?? null,
      codigo_servico: raw.codigo_servico ?? raw.item_lista_servico ?? null,
      cnae: raw.cnae ?? null,
      status: this.mapNfseRecebidaStatus(raw.status),
      xml: raw.xml ?? null,
      pdf_url: raw.url_pdf ?? raw.caminho_xml_nota_fiscal ?? null,
      raw,
    };
  }

  private mapNfseRecebidaStatus(raw?: string): NfseDocument['status'] {
    if (!raw) return 'AUTORIZADA';
    const s = raw.toString().toLowerCase();
    if (s.includes('cancel')) return 'CANCELADA';
    if (s.includes('rejeit') || s.includes('erro')) return 'REJEITADA';
    return 'AUTORIZADA';
  }

  // ============= Helpers =============

  private mapIssueStatus(raw: string | undefined | null): IssueNfseResult['status'] {
    if (!raw) return 'PENDENTE';
    const s = raw.toString().toLowerCase();
    if (s.includes('autoriz') || s === 'autorizado') return 'AUTORIZADA';
    if (s.includes('process') || s.includes('aguard')) return 'PROCESSANDO';
    if (s.includes('rejeit') || s.includes('erro') || s.includes('cancel')) {
      if (s.includes('cancel')) return 'REJEITADA'; // cancelada conta como não-autorizada
      return 'REJEITADA';
    }
    return 'PENDENTE';
  }

  private cleanCnpj(v: string): string {
    return v.replace(/\D/g, '');
  }

  private translateError(err: any): Error {
    const data = err.response?.data;
    const status = err.response?.status;
    const msg = data?.mensagem
      || (Array.isArray(data?.erros) ? data.erros.map((e: any) => e.mensagem || JSON.stringify(e)).join(' · ') : null)
      || data?.message
      || err.message;
    const e: any = new Error(`[FocusNFe ${status ?? '???'}] ${msg}`);
    e.status = status;
    e.raw = data;
    return e;
  }
}
