import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ProcuradorService } from './procurador.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Adapter para o Integra Contador da Serpro.
 *
 * Documentação: https://servicos.serpro.gov.br/integra-contador/
 * Catálogo de APIs: https://apicatalogo.serpro.gov.br/
 *
 * Autenticação: OAuth2 client_credentials.
 *   - POST {tokenUrl} com Basic auth (consumer_key:consumer_secret) gera access_token
 *   - access_token expira em ~47 min, fazemos cache em memória
 *
 * O Integra Contador concentra dezenas de APIs governamentais sob um envelope
 * comum chamado "Apoiar" / "Consultar" / "Emitir" / "Declarar". Cada chamada
 * informa qual sistema (idSistema) e qual serviço (idServico) está acionando.
 *
 * Sistemas comuns (idSistema):
 *   - DCTFWEB         - Declaração de Débitos e Créditos Tributários Federais
 *   - SITFIS          - Situação Fiscal de PJ
 *   - PGDASD          - PGDAS-D (Simples Nacional)
 *   - DEFIS           - Declaração do Simples Nacional
 *   - REGIMEAPURACAO  - Regime de Apuração
 *   - PGMEI           - PGMEI
 *   - CCMEI           - Certificado MEI
 *   - PARCSN          - Parcelamento Simples Nacional
 *   - PARCMEI         - Parcelamento MEI
 *   - AUTENTICAR      - Autenticação eCAC (procuração)
 *   - PROCURADOR      - Procuração eCAC
 *   - CAIXAPOSTAL     - Caixa Postal eCAC
 *   - PAGAMENTO       - Geração de DARF
 *   - EFDREINF        - EFD-Reinf (retenções!)
 */

interface CachedToken {
  access_token: string;
  expires_at: number; // epoch ms
}

export interface IntegraContadorRequest {
  /** Sistema do Integra Contador (DCTFWEB, SITFIS, etc.) */
  idSistema: string;
  /** Serviço dentro do sistema (ex: CONSDECRECEXT12, GERARDECRECEXT12) */
  idServico: string;
  versaoSistema?: string;
  /** Payload específico do serviço — JSON serializado como string */
  dados: any;

  /** CNPJ ou CPF do contratante (escritório contábil) */
  contratante: { numero: string; tipo: 1 | 2 }; // 1=CPF, 2=CNPJ
  /** CNPJ ou CPF do autor do pedido (geralmente igual ao contratante) */
  autorPedidoDados?: { numero: string; tipo: 1 | 2 };
  /** CNPJ ou CPF do contribuinte (cliente do escritório) */
  contribuinte: { numero: string; tipo: 1 | 2 };
}

@Injectable()
export class SerproAdapter {
  private readonly logger = new Logger(SerproAdapter.name);
  private readonly http: AxiosInstance;
  private readonly tokenUrl: string;
  private readonly basicAuth: string;
  private readonly integraPath: string;
  private cachedToken: CachedToken | null = null;

  constructor(private procurador: ProcuradorService, private prisma: PrismaService) {
    const consumerKey = process.env.SERPRO_CONSUMER_KEY;
    const consumerSecret = process.env.SERPRO_CONSUMER_SECRET;
    const baseUrl = process.env.SERPRO_BASE_URL ?? 'https://gateway.apiserpro.serpro.gov.br';
    this.tokenUrl = process.env.SERPRO_TOKEN_URL ?? `${baseUrl}/token`;
    this.integraPath = process.env.SERPRO_INTEGRA_PATH ?? '/integra-contador/v1';

    if (!consumerKey || !consumerSecret) {
      this.logger.warn('SERPRO_CONSUMER_KEY/SECRET não configurados — adapter desabilitado.');
      this.basicAuth = '';
    } else {
      this.basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    }

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 30_000,
      headers: { Accept: 'application/json' },
      // Serpro usa 304 em alguns serviços (ex: SITFIS) para indicar "dado
      // ainda válido / sem mudança". Aceitamos 2xx e 304, demais lançam.
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
    });
  }

  /**
   * Retorna se o adapter está minimamente configurado para tentar chamadas.
   */
  isConfigured(): boolean {
    return this.basicAuth !== '';
  }

  /**
   * Gera (ou retorna do cache) o access_token OAuth2.
   * Renova com 60s de antecedência da expiração.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Credenciais Serpro não configuradas no .env.');
    }

    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expires_at > now + 60_000) {
      return this.cachedToken.access_token;
    }

    try {
      const res = await axios.post(
        this.tokenUrl,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${this.basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15_000,
        },
      );
      const { access_token, expires_in } = res.data ?? {};
      if (!access_token) throw new Error('Resposta do Serpro sem access_token.');
      this.cachedToken = {
        access_token,
        expires_at: now + Number(expires_in ?? 3600) * 1000,
      };
      this.logger.log(`Serpro token renovado · expira em ${expires_in}s`);
      return access_token;
    } catch (err: any) {
      this.logger.error(`Falha ao gerar token Serpro: ${err.message}`);
      throw new BadRequestException(
        `Não foi possível gerar token Serpro: ${err.response?.data?.error_description || err.message}`,
      );
    }
  }

  /**
   * Health-check sem efeitos colaterais — só gera token e retorna metadados.
   */
  async healthCheck(): Promise<{ ok: boolean; expires_in_seconds?: number; scope?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: 'Credenciais não configuradas no .env' };
    try {
      const res = await axios.post(
        this.tokenUrl,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${this.basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15_000,
        },
      );
      // Atualiza cache também
      this.cachedToken = {
        access_token: res.data.access_token,
        expires_at: Date.now() + Number(res.data.expires_in ?? 3600) * 1000,
      };
      return {
        ok: true,
        expires_in_seconds: res.data.expires_in,
        scope: res.data.scope,
      };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error_description || err.message };
    }
  }

  /**
   * Chamada genérica ao Integra Contador.
   * O endpoint depende do tipo de operação:
   *   - /Apoiar       → consultas/listagens (idempotente, GET semântico)
   *   - /Consultar    → consultas com payload
   *   - /Emitir       → emissão de documentos (DARF, certidões)
   *   - /Declarar     → envio de declarações
   *   - /Monitorar    → polling de tarefas assíncronas
   */
  async call(operation: 'Apoiar' | 'Consultar' | 'Emitir' | 'Declarar' | 'Monitorar', body: IntegraContadorRequest): Promise<any> {
    // Toda chamada ao Integra Contador exige DOIS tokens (Bearer +
    // jwt_token). Ambos vêm do mesmo authenticate (mTLS Role-Type=TERCEIROS).
    // Se o procurador não estiver conectado, retorna mensagem clara.
    const procuradorJwt = this.procurador.getCachedJwt();
    const procuradorAccessToken = this.procurador.getCachedAccessToken();
    if (!procuradorJwt || !procuradorAccessToken) {
      throw new BadRequestException(
        'Procurador Serpro não autenticado. Acesse Configurações → "Procurador eCAC (Serpro)" e clique em Conectar.',
      );
    }

    // Envelope padrão do Integra Contador
    const payload = {
      contratante: body.contratante,
      autorPedidoDados: body.autorPedidoDados ?? body.contratante,
      contribuinte: body.contribuinte,
      pedidoDados: {
        idSistema: body.idSistema,
        idServico: body.idServico,
        versaoSistema: body.versaoSistema ?? '1.0',
        dados: typeof body.dados === 'string' ? body.dados : JSON.stringify(body.dados),
      },
    };

    const url = `${this.integraPath}/${operation}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${procuradorAccessToken}`,
      jwt_token: procuradorJwt,
      'Content-Type': 'application/json',
    };

    try {
      const res = await this.http.post(url, payload, { headers });
      // Log 304 explicitamente — Serpro usa pra "use cache anterior"
      if (res.status === 304) {
        this.logger.warn(`[Serpro ${operation}/${body.idSistema}/${body.idServico}] HTTP 304 (corpo: ${JSON.stringify(res.data).slice(0, 200)})`);
      }
      return res.data;
    } catch (err: any) {
      const data = err.response?.data;
      const message = data?.message || data?.mensagens?.[0]?.texto || err.message;
      this.logger.error(`[Serpro ${operation}/${body.idSistema}/${body.idServico}] ${message}`);
      throw new BadRequestException({
        provider: 'SERPRO_INTEGRA',
        operation, idSistema: body.idSistema, idServico: body.idServico,
        message, raw: data,
      });
    }
  }

  /**
   * Helpers de alto nível para casos de uso comuns no ContBet.
   */

  /** Consulta situação fiscal de uma PJ (regularidade fiscal — útil pra validar fornecedores antes de pagamento) */
  /**
   * SITFIS é assíncrono. Faz os dois passos:
   *   1. /Apoiar SOLICITARPROTOCOLO91 → protocolo + tempoEspera
   *   2. aguarda tempoEspera ms
   *   3. /Emitir EMITIRRELATORIO92 com o protocolo → relatório (PDF base64 +
   *      dados estruturados)
   * Retorna o relatório final + metadados.
   */
  async consultarSituacaoFiscal(args: { contratanteCnpj: string; contribuinteCnpj: string }) {
    const contribuinteKey = cleanCnpj(args.contribuinteCnpj);

    // Passo 1: solicitar protocolo (pode retornar 304 se já houver válido)
    const apoiar = await this.call('Apoiar', {
      idSistema: 'SITFIS',
      idServico: 'SOLICITARPROTOCOLO91',
      versaoSistema: '2.0',
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: contribuinteKey, tipo: 2 },
      dados: '',
    });

    let dadosObj: any = apoiar?.dados;
    if (typeof dadosObj === 'string') {
      try { dadosObj = JSON.parse(dadosObj); } catch { /* mantém como string */ }
    }
    let protocoloRelatorio = dadosObj?.protocoloRelatorio;
    let tempoEspera = Number(dadosObj?.tempoEspera ?? 4000);

    // Se Serpro não devolveu protocolo (304/sem body), reusa o cacheado no
    // banco (sobrevive a restarts).
    if (!protocoloRelatorio) {
      const cached = await this.prisma.serproSitfisProtocol.findUnique({
        where: { contribuinte_cnpj: contribuinteKey },
      });
      // Serpro mantém o relatório por ~30 min; damos 60min de folga
      if (cached && Date.now() - cached.cached_at.getTime() < 60 * 60_000) {
        this.logger.log(`SITFIS reusando protocolo em cache (DB) para CNPJ ${contribuinteKey}.`);
        protocoloRelatorio = cached.protocolo_relatorio;
        tempoEspera = 0;
      }
    } else {
      // Persiste para o próximo call (mesmo após restart)
      await this.prisma.serproSitfisProtocol.upsert({
        where: { contribuinte_cnpj: contribuinteKey },
        create: {
          contribuinte_cnpj: contribuinteKey,
          protocolo_relatorio: protocoloRelatorio,
          tempo_espera: tempoEspera,
        },
        update: {
          protocolo_relatorio: protocoloRelatorio,
          tempo_espera: tempoEspera,
          cached_at: new Date(),
        },
      });
    }

    if (!protocoloRelatorio) {
      // Tenta inferir há quanto tempo o protocolo está em cache do Serpro.
      // Não é exato, mas ajuda o usuário saber quanto falta.
      const oldCached = await this.prisma.serproSitfisProtocol.findFirst({
        orderBy: { cached_at: 'desc' },
      });
      const ageMinutes = oldCached
        ? Math.floor((Date.now() - oldCached.cached_at.getTime()) / 60_000)
        : null;

      throw new BadRequestException(
        ageMinutes !== null
          ? `Serpro está em deadlock de cache para esse CNPJ. Última requisição registrada há ${ageMinutes} min. O Serpro mantém protocolos por ~30 min — tente em ${Math.max(0, 30 - ageMinutes)} min, ou teste a integração com OUTRA empresa cadastrada (CNPJ diferente não tem deadlock).`
          : `Serpro mantém um protocolo SITFIS em cache do lado deles que o ContBet não conhece (provavelmente gerado em uma sessão anterior à persistência). Aguarde ~30 min, ou teste o SITFIS de outra empresa (CNPJ diferente não tem deadlock).`,
      );
    }

    // Passo 2: aguardar tempo de espera (Receita exige)
    this.logger.log(`SITFIS aguardando ${tempoEspera}ms para emitir relatório…`);
    await new Promise((resolve) => setTimeout(resolve, tempoEspera));

    // Passo 3: emitir relatório com o protocolo
    const emitir = await this.call('Emitir', {
      idSistema: 'SITFIS',
      idServico: 'RELATORIOSITFIS92',
      versaoSistema: '2.0',
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: cleanCnpj(args.contribuinteCnpj), tipo: 2 },
      dados: { protocoloRelatorio },
    });

    return {
      step: 'emitirRelatorio',
      solicitacao: apoiar,
      relatorio: emitir,
    };
  }

  /**
   * Consulta declaração completa DCTFWeb de um mês específico.
   * categoria: 'GERAL_MENSAL' (default — pessoas jurídicas mensais) | 'PF_MENSAL'
   *           | '13_SALARIO' | 'ESPETACULO_DESPORTIVO' etc.
   */
  async consultarDctfWebDeclaracao(args: {
    contratanteCnpj: string; contribuinteCnpj: string;
    categoria?: string; anoPA: string; mesPA: string;
  }) {
    return this.call('Consultar', {
      idSistema: 'DCTFWEB',
      idServico: 'CONSDECCOMPLETA33',
      versaoSistema: '1.0',
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: cleanCnpj(args.contribuinteCnpj), tipo: 2 },
      dados: {
        categoria: args.categoria ?? 'GERAL_MENSAL',
        anoPA: args.anoPA,
        mesPA: args.mesPA,
      },
    });
  }

  /** Recibo de transmissão de uma DCTFWeb específica */
  async consultarReciboDctfWeb(args: { contratanteCnpj: string; contribuinteCnpj: string; numeroReciboDeclaracao: string }) {
    return this.call('Consultar', {
      idSistema: 'DCTFWEB',
      idServico: 'CONSRECIBO32',
      versaoSistema: '1.0',
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: cleanCnpj(args.contribuinteCnpj), tipo: 2 },
      dados: { numeroReciboDeclaracao: args.numeroReciboDeclaracao },
    });
  }

  /**
   * Lista TODAS as procurações eCAC ativas do contratante (Valentim).
   * Útil pra confirmar quais clientes outorgaram acesso. Aqui contribuinte
   * pode ser igual ao contratante — Serpro retorna tudo.
   */
  async obterProcuracoes(args: { contratanteCnpj: string; outorganteCnpj?: string }) {
    const contratante = cleanCnpj(args.contratanteCnpj);
    // Outorgante = contribuinte que outorgou; outorgado = contratante (Valentim).
    // Quando consultando o que a Valentim recebeu, outorgante = Valentim
    // (porque o Serpro filtra por outorgado=outorgante quando passamos
    // o mesmo CNPJ — efetivamente "minhas procurações outorgadas").
    const outorgante = cleanCnpj(args.outorganteCnpj ?? args.contratanteCnpj);
    return this.call('Consultar', {
      idSistema: 'PROCURACOES',
      idServico: 'OBTERPROCURACAO41',
      versaoSistema: '1',
      contratante: { numero: contratante, tipo: 2 },
      contribuinte: { numero: outorgante, tipo: 2 },
      dados: {
        outorgante,
        tipoOutorgante: '2',
        outorgado: contratante,
        tipoOutorgado: '2',
      },
    });
  }

  /**
   * Lista mensagens da caixa postal eCAC de um contribuinte.
   * statusLeitura: "0" = todas, "1" = só lidas, "2" = só não-lidas.
   * Pagina inicial: indicadorPagina="0", ponteiroPagina="00000000000000".
   */
  async listarCaixaPostal(args: {
    contratanteCnpj: string; contribuinteCnpj: string;
    statusLeitura?: string; indicadorPagina?: string; ponteiroPagina?: string;
  }) {
    return this.call('Consultar', {
      idSistema: 'CAIXAPOSTAL',
      idServico: 'MSGCONTRIBUINTE61',
      versaoSistema: '1.0',
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: cleanCnpj(args.contribuinteCnpj), tipo: 2 },
      dados: {
        statusLeitura: args.statusLeitura ?? '0',
        indicadorPagina: args.indicadorPagina ?? '0',
        ponteiroPagina: args.ponteiroPagina ?? '00000000000000',
      },
    });
  }

  /** Gera um DARF para um tributo */
  async emitirDarf(args: {
    contratanteCnpj: string; contribuinteCnpj: string;
    codigoReceita: string; periodoApuracao: string; valorPrincipal: number;
    dataConsolidacao?: string;
  }) {
    return this.call('Emitir', {
      idSistema: 'PAGAMENTO',
      idServico: 'GERARDARF61',
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: cleanCnpj(args.contribuinteCnpj), tipo: 2 },
      dados: {
        codigoReceita: args.codigoReceita,
        periodoApuracao: args.periodoApuracao,
        valorPrincipal: args.valorPrincipal.toFixed(2),
        dataConsolidacao: args.dataConsolidacao,
      },
    });
  }

  /** EFD-Reinf — envia evento de retenção (R-2010, R-2020, R-2030, etc.) */
  async enviarEventoReinf(args: { contratanteCnpj: string; contribuinteCnpj: string; xmlEvento: string; tipoEvento: string }) {
    return this.call('Declarar', {
      idSistema: 'EFDREINF',
      idServico: args.tipoEvento, // ex: 'ENVIOLOTEEVENTOSR2010'
      contratante: { numero: cleanCnpj(args.contratanteCnpj), tipo: 2 },
      contribuinte: { numero: cleanCnpj(args.contribuinteCnpj), tipo: 2 },
      dados: { xml: args.xmlEvento },
    });
  }

  /**
   * Discovery — testa cada sistema do Integra Contador chamando o serviço de
   * "consulta apoio" (Apoiar) que é idempotente. Identifica:
   *   - 200/Sucesso          → sistema liberado e procuração OK
   *   - 401/403 + erro_auth  → sistema NÃO contratado
   *   - 403 + ProcuracaoErr  → sistema contratado MAS sem procuração eCAC do contribuinte
   *   - 400 + dados inválido → sistema contratado, só faltou payload válido
   *
   * Use o mesmo CNPJ no contratante e contribuinte (auto-consulta) para
   * evitar dependência de procuração.
   */
  async discoverContractedSystems(contratanteCnpj: string): Promise<Array<{
    idSistema: string;
    idServico: string;
    description: string;
    status: 'AVAILABLE' | 'NOT_CONTRACTED' | 'NEEDS_ECAC' | 'ERROR' | 'UNKNOWN';
    http_status?: number;
    message?: string;
  }>> {
    if (!this.isConfigured()) {
      throw new BadRequestException('Credenciais Serpro não configuradas no .env.');
    }
    const cnpj = cleanCnpj(contratanteCnpj);

    // Sondas com IDs reais do catálogo oficial Serpro (Integra Contador).
    // Ref: apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador
    const probes: Array<{ idSistema: string; idServico: string; operation: 'Apoiar' | 'Consultar' | 'Monitorar'; description: string; dados: any }> = [
      { idSistema: 'DCTFWEB',             idServico: 'CONSRECIBO32',         operation: 'Consultar', description: 'DCTFWeb · Consultar Recibo',          dados: { categoria: 'GERAL', anoPA: String(new Date().getFullYear()) } },
      { idSistema: 'MIT',                 idServico: 'LISTAAPURACOES317',    operation: 'Consultar', description: 'MIT · Listar Apurações',              dados: { anoApuracao: String(new Date().getFullYear()) } },
      { idSistema: 'SITFIS',              idServico: 'SOLICITARPROTOCOLO91', operation: 'Apoiar',    description: 'Situação Fiscal · Protocolo',         dados: '' },
      { idSistema: 'PGDASD',              idServico: 'CONSDECLARACAO13',     operation: 'Consultar', description: 'PGDAS-D · Listar Declarações',        dados: { periodoApuracao: String(new Date().getFullYear()) + String(new Date().getMonth() + 1).padStart(2,'0') } },
      { idSistema: 'DEFIS',               idServico: 'CONSDECLARACAO142',    operation: 'Consultar', description: 'DEFIS · Listar Declarações',          dados: { periodoApuracao: String(new Date().getFullYear() - 1) } },
      { idSistema: 'PAGTOWEB',            idServico: 'PAGAMENTOS71',         operation: 'Consultar', description: 'PagtoWeb · Consultar Pagamentos',     dados: { dataInicial: '01/01/' + (new Date().getFullYear() - 1), dataFinal: '31/12/' + (new Date().getFullYear() - 1) } },
      { idSistema: 'CAIXAPOSTAL',         idServico: 'MSGCONTRIBUINTE61',    operation: 'Consultar', description: 'Caixa Postal · Mensagens',            dados: { statusLeitura: 0 } },
      { idSistema: 'CAIXAPOSTAL',         idServico: 'INNOVAMSG63',          operation: 'Monitorar', description: 'Caixa Postal · Indicador Novas Msgs', dados: '' },
      { idSistema: 'DTE',                 idServico: 'CONSULTASITUACAODTE111', operation: 'Consultar', description: 'DTE · Situação Adesão',             dados: '' },
      { idSistema: 'AUTENTICAPROCURADOR', idServico: 'ENVIOXMLASSINADO81',   operation: 'Apoiar',    description: 'Autenticar Procurador',                dados: '' },
    ];

    type DiscoveryResult = {
      idSistema: string;
      idServico: string;
      description: string;
      status: 'AVAILABLE' | 'NOT_CONTRACTED' | 'NEEDS_ECAC' | 'ERROR' | 'UNKNOWN';
      http_status?: number;
      message?: string;
    };

    // Roda todas as sondas em paralelo (concorrência limitada a 5 para não estourar rate-limit)
    const probe = async (p: typeof probes[0]): Promise<DiscoveryResult> => {
      try {
        await this.call(p.operation, {
          idSistema: p.idSistema,
          idServico: p.idServico,
          contratante: { numero: cnpj, tipo: 2 },
          contribuinte: { numero: cnpj, tipo: 2 },
          dados: p.dados,
        });
        return { idSistema: p.idSistema, idServico: p.idServico, description: p.description, status: 'AVAILABLE' };
      } catch (err: any) {
        const raw = err?.response?.data ?? err?.raw ?? {};
        const httpStatus = err?.response?.status ?? err?.status;
        const message = err?.response?.data?.message ?? err?.message ?? '';
        const fullText = (message + ' ' + JSON.stringify(raw)).toLowerCase();
        let status: DiscoveryResult['status'];
        if (httpStatus === 401 || /unauthorized|invalid\s+scope/.test(fullText)) {
          status = 'NOT_CONTRACTED';
        } else if (/n[ãa]o\s+contrat|sem\s+contrato/.test(fullText)) {
          status = 'NOT_CONTRACTED';
        } else if (/identifica[c\u00e7][\u00e3a]o\s+do\s+sistema|inexistente\s+no\s+cat[\u00e1a]logo/.test(fullText)) {
          // 400 com "Identificação inválida" = ID errado OU sistema não existe pra esse contrato
          // Tratamos como NOT_CONTRACTED já que com ID válido + sem contrato volta esse erro
          status = 'NOT_CONTRACTED';
        } else if (httpStatus === 403 || /procura[c\u00e7][\u00e3a]o|sem\s+procurador|ecac/.test(fullText)) {
          status = 'NEEDS_ECAC';
        } else if (httpStatus === 400) {
          // 400 com outra mensagem = sistema responde, só faltou payload válido = AVAILABLE
          status = 'AVAILABLE';
        } else if (httpStatus) {
          status = 'ERROR';
        } else {
          status = 'UNKNOWN';
        }
        return {
          idSistema: p.idSistema, idServico: p.idServico, description: p.description,
          status, http_status: httpStatus, message: message.slice(0, 200),
        };
      }
    };

    // Executa em batches de 5 paralelas
    const results: DiscoveryResult[] = [];
    for (let i = 0; i < probes.length; i += 5) {
      const batch = probes.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(probe));
      results.push(...batchResults);
    }
    return results;
  }
}

function cleanCnpj(v: string): string {
  return v.replace(/\D/g, '').padStart(14, '0');
}
