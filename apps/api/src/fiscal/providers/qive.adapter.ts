/**
 * Qive (antiga Arquivei) adapter — captador de NFSe Tomadas (e NFe).
 *
 * Diferente de Plugnotas/Focus que emitem documentos, a Qive é um captador:
 * monitora os portais municipais/estaduais/nacional e baixa as notas que
 * sua empresa RECEBE de terceiros. Cobertura de NFSe Municipal é a mais
 * ampla do mercado brasileiro.
 *
 * Auth: 3 headers obrigatórios:
 *   X-API-ID
 *   X-API-KEY
 *   X-Use-ApiGateway: always
 *
 * Endpoints utilizados:
 *   GET /v2/nfse/received   → lista NFSe TOMADAS (com XML em base64)
 *   GET /v2/nfse/received/{id} → detalhe individual
 *   POST /v2/dfe/nfe        → consulta NFe com filtros
 *
 * Spec: https://developers.qive.com.br
 */

import axios, { AxiosInstance } from 'axios';
import { DOMParser } from '@xmldom/xmldom';
import {
  FiscalProviderAdapter,
  RegisterCompanyInput,
  UploadCertificateInput,
  IssueNfseInput,
  IssueNfseResult,
  FetchNfseInput,
  NfseDocument,
  NfeDocument,
} from './plugnotas.adapter';

interface QiveCredentials {
  apiId: string;
  apiKey: string;
}

export class QiveAdapter implements FiscalProviderAdapter {
  private http: AxiosInstance;

  /**
   * Aceita api_key no formato "apiId:apiKey" (concatenado) ou só apiKey
   * com apiId vindo de env. Convenção: usuário cola "id:key" no campo
   * api_key do FiscalProvider, simplificando.
   */
  constructor(apiKeyOrCombined: string, sandbox: boolean = true) {
    let apiId = process.env.QIVE_API_ID ?? '';
    let apiKey = apiKeyOrCombined;
    if (apiKeyOrCombined.includes(':')) {
      const [id, key] = apiKeyOrCombined.split(':');
      apiId = id.trim();
      apiKey = key.trim();
    } else if (!apiId) {
      // Fallback: assume todo valor é a key e que o id está no env
      apiKey = apiKeyOrCombined;
    }

    const baseURL = sandbox
      ? (process.env.QIVE_BASE_URL_SANDBOX ?? 'https://sandbox-api.arquivei.com.br')
      : (process.env.QIVE_BASE_URL_PROD ?? 'https://api.arquivei.com.br');

    this.http = axios.create({
      baseURL,
      timeout: 30_000,
      headers: {
        'X-API-ID': apiId,
        'X-API-KEY': apiKey,
        'X-Use-ApiGateway': 'always',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  async ping(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.http.get('/v2/nfse/received?limit=1', {
        validateStatus: () => true,
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Credenciais Qive rejeitadas (HTTP ${res.status})` };
      }
      return { ok: true, message: `Auth OK (HTTP ${res.status})` };
    } catch (err: any) {
      return { ok: false, message: `Falha de rede: ${err.message}` };
    }
  }

  /** Captador não gerencia empresas — cadastro é feito no painel Qive. */
  async registerCompany(_input: RegisterCompanyInput): Promise<{ id: string }> {
    return { id: this.cleanCnpj(_input.cnpj) };
  }

  /** Captador não usa A1 — os XMLs vêm dos portais. */
  async uploadCertificate(_input: UploadCertificateInput): Promise<{ id: string }> {
    throw new Error(
      'Qive não usa certificado A1 — os XMLs são capturados via portais públicos. ' +
      'Use Focus NFe / PlugNotas para upload de A1.',
    );
  }

  /**
   * Lista NFSe Tomadas pela empresa. Faz paginação via cursor (Paginator).
   *
   * IMPORTANTE: a API Qive retorna NFSe da CONTA TODA (todos os CNPJs
   * cadastrados na conta Qive), não filtra por CNPJ no endpoint padrão.
   * A gente filtra client-side por `cnpj_tomador` lendo o XML.
   */
  async fetchIncomingNfse(input: FetchNfseInput): Promise<NfseDocument[]> {
    const cnpjFilter = this.cleanCnpj(input.cnpj);
    const collected: NfseDocument[] = [];
    // Diagnóstico: contagem do que veio da Qive vs o que sobrou após filtro.
    let totalRecebidas = 0;
    let foraDeData = 0;
    let cnpjsDistintos = new Set<string>();
    // Qive devolve a próxima página como URL completa em `page.next`.
    // Extraímos só o cursor pra reutilizar a baseURL configurada no axios.
    let cursor: string | null = null;
    let calls = 0;
    const limit = 50;

    while (true) {
      const params: any = { limit };
      if (cursor) params.cursor = cursor;

      let res;
      try {
        res = await this.http.get('/v2/nfse/received', {
          params,
          validateStatus: () => true,
        });
      } catch (err: any) {
        throw this.translateError(err);
      }

      if (res.status === 404 || res.status === 204) break;
      if (res.status >= 400) {
        // Log diagnóstico — registra o que Qive devolveu pra entender 400/etc.
        // eslint-disable-next-line no-console
        console.error('[Qive] erro HTTP', res.status, '— params:', JSON.stringify(params),
          '— body:', JSON.stringify(res.data).slice(0, 400),
          '— headers configurados id_len:', this.http.defaults.headers?.['X-API-ID']?.toString().length,
          'key_len:', this.http.defaults.headers?.['X-API-KEY']?.toString().length);
        throw this.translateError({ response: res });
      }

      const data: any[] = res.data?.data ?? [];
      if (!data.length) break;

      for (const item of data) {
        totalRecebidas += 1;
        const parsed = this.parseNfseFromXml(item.xml, item.id);
        if (!parsed) continue;
        if (parsed.tomador_cnpj) cnpjsDistintos.add(parsed.tomador_cnpj);
        // Filtro client-side por tomador e janela de data
        const docDate = parsed.data_emissao;
        if (docDate < input.start_date || docDate > input.end_date) {
          foraDeData += 1;
          continue;
        }
        if (parsed.tomador_cnpj !== cnpjFilter) continue;
        collected.push(parsed);
      }

      // Próxima página: extrai o ?cursor= da URL completa que Qive devolve
      const nextRaw: string | null = res.data?.page?.next ?? null;
      if (!nextRaw) break;
      const cursorMatch = nextRaw.match(/[?&]cursor=([^&]+)/);
      cursor = cursorMatch ? decodeURIComponent(cursorMatch[1]) : null;
      if (!cursor) break;

      calls += 1;
      if (calls > 200) break; // segurança — 200 páginas * 50 = 10k notas
    }
    // eslint-disable-next-line no-console
    console.log(
      `[Qive] sincronização: filtro_cnpj=${cnpjFilter}, recebidas=${totalRecebidas}, ` +
      `fora_de_data=${foraDeData}, encontradas=${collected.length}, ` +
      `cnpjs_tomador_distintos=[${[...cnpjsDistintos].join(', ')}]`,
    );
    return collected;
  }

  /**
   * Parser robusto do XML Abrasf 2.x (NFSe municipal) usando DOM. Ignora
   * namespaces (busca por local-name), suporta variantes (PrestadorServico
   * vs Prestador, IdentificacaoPrestador vs CpfCnpj direto).
   */
  private parseNfseFromXml(xmlBase64: string, providerId: string): NfseDocument | null {
    try {
      const xml = Buffer.from(xmlBase64, 'base64').toString('utf-8');
      const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } })
        .parseFromString(xml, 'text/xml');

      // Helper: encontra o primeiro elemento por local-name (independente de namespace)
      const findFirst = (root: any, localName: string): any | null => {
        const walker = (node: any): any => {
          if (!node) return null;
          if (node.nodeType === 1 && (node.localName === localName || node.nodeName?.split(':').pop() === localName)) {
            return node;
          }
          const children = node.childNodes;
          if (!children) return null;
          for (let i = 0; i < children.length; i++) {
            const found = walker(children[i]);
            if (found) return found;
          }
          return null;
        };
        return walker(root);
      };
      const text = (node: any): string | null => {
        if (!node) return null;
        return (node.textContent ?? '').trim() || null;
      };
      const findText = (root: any, localName: string): string | null =>
        text(findFirst(root, localName));
      // Encontra um elemento aninhado descendente. Útil pra desambiguar
      // ValorIss dentro de PrestadorServico vs ValorIss dentro de Servico.
      const findIn = (parentName: string, childName: string): string | null => {
        const parent = findFirst(doc, parentName);
        if (!parent) return null;
        return findText(parent, childName);
      };

      const numero = findText(doc, 'Numero') ?? '';
      const codigoVerif = findText(doc, 'CodigoVerificacao') ?? null;
      const dataEmissaoRaw = findText(doc, 'DataEmissao') ?? '';
      const dataEmissao = dataEmissaoRaw ? new Date(dataEmissaoRaw) : new Date();

      const valoresNode = findFirst(doc, 'ValoresNfse') ?? findFirst(doc, 'Valores');
      const valorTotal = Number(
        (valoresNode ? findText(valoresNode, 'ValorLiquidoNfse') : null)
          ?? (valoresNode ? findText(valoresNode, 'ValorServicos') : null)
          ?? findText(doc, 'ValorLiquidoNfse')
          ?? findText(doc, 'ValorServicos')
          ?? 0,
      );
      const valorServicos = Number(
        (valoresNode ? findText(valoresNode, 'ValorServicos') : null) ?? valorTotal,
      );
      const issValor = Number((valoresNode ? findText(valoresNode, 'ValorIss') : null) ?? 0);
      const aliquotaRaw = (valoresNode ? findText(valoresNode, 'Aliquota') : null);
      const issAliquota = aliquotaRaw ? Number(aliquotaRaw) : null;

      const prestadorNode = findFirst(doc, 'PrestadorServico') ?? findFirst(doc, 'Prestador');
      const prestadorCnpj = prestadorNode ? findText(prestadorNode, 'Cnpj') : findText(doc, 'Cnpj');
      const prestadorNome = prestadorNode ? findText(prestadorNode, 'RazaoSocial') : null;

      const tomadorNode = findFirst(doc, 'TomadorServico') ?? findFirst(doc, 'Tomador');
      const tomadorCnpj = tomadorNode ? findText(tomadorNode, 'Cnpj') : null;
      const tomadorNome = tomadorNode ? findText(tomadorNode, 'RazaoSocial') : null;

      const servicoNode = findFirst(doc, 'Servico');
      const codigoMunicipio = servicoNode ? findText(servicoNode, 'CodigoMunicipio') : null;
      const descricao = servicoNode ? findText(servicoNode, 'Discriminacao') : null;
      const codigoServico = servicoNode ? (findText(servicoNode, 'ItemListaServico') ?? findText(servicoNode, 'CodigoTributacaoMunicipio')) : null;

      return {
        provider_id: providerId,
        numero_nota: numero,
        serie: null,
        chave_acesso: codigoVerif,
        data_emissao: dataEmissao,

        prestador_cnpj: this.cleanCnpj(prestadorCnpj ?? ''),
        prestador_nome: prestadorNome ?? '',
        prestador_municipio_codigo: codigoMunicipio,

        tomador_cnpj: tomadorCnpj ? this.cleanCnpj(tomadorCnpj) : null,
        tomador_nome: tomadorNome,

        valor_total: valorTotal,
        valor_servicos: valorServicos,
        iss_valor: issValor,
        iss_aliquota: issAliquota,
        irrf_valor: Number(findIn('ValoresNfse', 'ValorIr') ?? findText(doc, 'ValorIr') ?? 0),
        inss_valor: Number(findIn('ValoresNfse', 'ValorInss') ?? findText(doc, 'ValorInss') ?? 0),
        pis_valor: Number(findIn('ValoresNfse', 'ValorPis') ?? findText(doc, 'ValorPis') ?? 0),
        cofins_valor: Number(findIn('ValoresNfse', 'ValorCofins') ?? findText(doc, 'ValorCofins') ?? 0),
        csll_valor: Number(findIn('ValoresNfse', 'ValorCsll') ?? findText(doc, 'ValorCsll') ?? 0),

        descricao,
        codigo_servico: codigoServico,
        cnae: null,
        status: 'AUTORIZADA',

        xml,
        pdf_url: null,
        raw: { xmlBase64, providerId },
      };
    } catch (err) {
      console.warn('[Qive] erro parse NFSe:', (err as Error).message);
      return null;
    }
  }

  /** Qive é read-only pra NFSe — emissão usa Plugnotas/Focus. */
  async issueNfse(_input: IssueNfseInput): Promise<IssueNfseResult> {
    throw new Error('Qive é captador (read-only). Use Focus NFe ou PlugNotas para emitir NFSe.');
  }

  /**
   * Consulta eventos de manifestação registrados pra uma NFe (Ciência da
   * Operação, Confirmação, Desconhecimento, Operação Não Realizada).
   * Endpoint: GET /v2/nfe/events?access_key=<chave>
   */
  async fetchNfeEvents(accessKey: string): Promise<any[]> {
    if (!accessKey) return [];
    try {
      const res = await this.http.get('/v2/nfe/events', {
        params: { access_key: accessKey },
        validateStatus: () => true,
      });
      if (res.status === 404 || res.status === 204) return [];
      if (res.status >= 400) throw this.translateError({ response: res });
      return res.data?.data ?? res.data?.events ?? [];
    } catch (err: any) {
      throw this.translateError(err);
    }
  }

  async fetchDocumentXml(documentId: string): Promise<string> {
    const res = await this.http.get(`/v2/nfse/received/${documentId}`, {
      validateStatus: () => true,
    });
    if (res.status >= 400) throw this.translateError({ response: res });
    const xmlBase64 = res.data?.data?.xml ?? res.data?.xml;
    if (!xmlBase64) throw new Error('Resposta Qive sem campo xml.');
    return Buffer.from(xmlBase64, 'base64').toString('utf-8');
  }

  // ============= NFe Recebidas (modelo 55 — entradas/fornecedores) =============

  /**
   * Lista NFe RECEBIDAS pelo CNPJ informado.
   * Endpoint: POST /v2/dfe/nfe com filter.receivers_cnpj
   * Resposta paginada por cursor (next na resposta).
   */
  async fetchIncomingNfe(input: FetchNfseInput): Promise<NfeDocument[]> {
    const cnpj = this.cleanCnpj(input.cnpj);
    const collected: NfeDocument[] = [];
    let cursor: string | null = null;
    let calls = 0;

    while (true) {
      const body: any = {
        filter: { receivers_cnpj: [cnpj] },
        limit: 50,
      };
      if (cursor) body.cursor = cursor;

      let res;
      try {
        res = await this.http.post('/v2/dfe/nfe', body, { validateStatus: () => true });
      } catch (err: any) {
        throw this.translateError(err);
      }

      if (res.status === 404 || res.status === 204) break;
      if (res.status >= 400) {
        // eslint-disable-next-line no-console
        console.error('[Qive NFe] erro HTTP', res.status, '— body:', JSON.stringify(res.data).slice(0, 400));
        throw this.translateError({ response: res });
      }

      const list: any[] = res.data?.Nfes ?? res.data?.data ?? [];
      if (!list.length) break;

      for (const item of list) {
        const parsed = this.parseNfeFromResumo(item);
        if (!parsed) continue;
        // Filtro client-side por janela de data
        if (parsed.data_emissao < input.start_date || parsed.data_emissao > input.end_date) continue;
        collected.push(parsed);
      }

      cursor = res.data?.page?.next
        ? (res.data.page.next.match(/[?&]cursor=([^&]+)/)?.[1] ?? null)
        : null;
      if (!cursor) cursor = res.data?.next ?? null;
      if (!cursor) break;
      calls += 1;
      if (calls > 200) break;
    }
    return collected;
  }

  /**
   * Parser do <resNFe> (resumo) que Qive devolve. Inclui chNFe, CNPJ
   * emitente, xNome, vNF, dhEmi, nProt e cSitNFe.
   */
  private parseNfeFromResumo(item: any): NfeDocument | null {
    try {
      const xmlBase64 = item.Xml ?? item.xml;
      if (!xmlBase64) return null;
      const xml = Buffer.from(xmlBase64, 'base64').toString('utf-8');
      const doc = new DOMParser({ errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} } })
        .parseFromString(xml, 'text/xml');

      const findFirst = (root: any, localName: string): any | null => {
        const walker = (n: any): any => {
          if (!n) return null;
          if (n.nodeType === 1 && (n.localName === localName || n.nodeName?.split(':').pop() === localName)) return n;
          const c = n.childNodes;
          if (!c) return null;
          for (let i = 0; i < c.length; i++) { const f = walker(c[i]); if (f) return f; }
          return null;
        };
        return walker(root);
      };
      const txt = (n: any) => (n ? (n.textContent ?? '').trim() || null : null);
      const ft = (name: string) => txt(findFirst(doc, name));

      const accessKey = item.AccessKey ?? ft('chNFe') ?? '';
      const numero = accessKey.length === 44 ? accessKey.slice(25, 34).replace(/^0+/, '') : null;
      const serie = accessKey.length === 44 ? accessKey.slice(22, 25).replace(/^0+/, '') || '0' : null;
      const dhEmi = ft('dhEmi') ?? ft('dEmi');
      const dataEmissao = dhEmi ? new Date(dhEmi) : new Date();

      const cnpjEmit = ft('CNPJ') ?? '';
      const xNome = ft('xNome') ?? '';
      const ie = ft('IE');
      const vNF = Number(ft('vNF') ?? 0);
      const cSit = ft('cSitNFe') ?? '1'; // 1=autorizada
      const status: NfeDocument['status'] =
        cSit === '2' ? 'CANCELADA' : cSit === '3' ? 'DENEGADA' : cSit === '4' ? 'INUTILIZADA' : 'AUTORIZADA';

      return {
        provider_id: accessKey,
        chave_acesso: accessKey,
        numero_nota: numero,
        serie,
        data_emissao: dataEmissao,

        emitente_cnpj: this.cleanCnpj(cnpjEmit),
        emitente_nome: xNome,
        emitente_ie: ie,

        destinatario_cnpj: '', // não vem no resumo; será preenchido se fizermos fetch do XML completo
        destinatario_nome: null,

        valor_total: vNF,
        valor_produtos: vNF,
        valor_icms: 0,
        valor_ipi: 0,
        valor_pis: 0,
        valor_cofins: 0,

        cfop: null,
        natureza_operacao: null,

        status,
        protocolo: ft('nProt'),
        xml,
        raw: item,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Qive NFe] erro parse resumo:', (err as Error).message);
      return null;
    }
  }

  private cleanCnpj(v: string): string {
    return (v ?? '').replace(/\D/g, '');
  }

  private translateError(err: any): Error {
    const data = err.response?.data;
    const status = err.response?.status;
    const msg = data?.error ?? data?.message ?? data?.status?.message ?? `HTTP ${status}`;
    return new Error(`[Qive ${status ?? '?'}] ${msg}`);
  }
}
