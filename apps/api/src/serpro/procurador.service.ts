import { Injectable, Logger, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';
import * as forge from 'node-forge';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt, encrypt } from '../fiscal/crypto.helper';

/**
 * Procurador Serpro Integra Contador.
 *
 * Para que o escritório (Valentim) consulte dados de clientes via Integra
 * Contador, todas as chamadas precisam de DOIS headers:
 *   - Authorization: Bearer <access_token>
 *   - jwt_token:     <jwt_token>
 *
 * Ambos vêm de UMA única chamada ao endpoint de autenticação Serpro:
 *
 *   POST https://autenticacao.sapi.serpro.gov.br/authenticate
 *     Headers:
 *       Authorization: Basic {consumerKey:consumerSecret}
 *       Role-Type:     TERCEIROS    (← autentica como procurador)
 *       Content-Type:  application/x-www-form-urlencoded
 *     Body: grant_type=client_credentials
 *     mTLS: certificado A1 do escritório no handshake TLS
 *
 * A Receita extrai o CNPJ do certificado e gera o jwt_token amarrado a esse
 * CNPJ. Esse JWT pode ser usado para consultar QUALQUER cliente que tenha
 * outorgado procuração eCAC para esse CNPJ. JWT dura tipicamente ~1h, é
 * cacheado em memória aqui.
 *
 * Spec: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/quick_start/
 */

interface CachedJwt {
  jwt_token: string;
  access_token: string;
  expires_at: number;
  contratante_cnpj: string;
}

@Injectable()
export class ProcuradorService implements OnModuleInit {
  private readonly logger = new Logger(ProcuradorService.name);
  private cache: CachedJwt | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Ao iniciar o módulo, restaura sessão do banco se ainda válida. */
  async onModuleInit() {
    try {
      const row = await this.prisma.serproSession.findFirst({ orderBy: { updated_at: 'desc' } });
      if (!row) return;
      if (row.expires_at.getTime() < Date.now()) {
        this.logger.log('Sessão Serpro persistida está expirada — descartando.');
        await this.prisma.serproSession.deleteMany();
        return;
      }
      this.cache = {
        jwt_token: decrypt(row.encrypted_jwt_token),
        access_token: decrypt(row.encrypted_access_token),
        expires_at: row.expires_at.getTime(),
        contratante_cnpj: row.contratante_cnpj,
      };
      const remainingMin = Math.floor((row.expires_at.getTime() - Date.now()) / 60_000);
      this.logger.log(`Sessão Serpro restaurada do banco (${remainingMin} min restantes).`);
    } catch (err: any) {
      this.logger.warn(`Falha ao restaurar sessão Serpro: ${err.message}`);
    }
  }

  private async persistCache() {
    if (!this.cache) return;
    // Sempre 1 linha (singleton). Apaga as outras e upserta.
    await this.prisma.serproSession.deleteMany();
    await this.prisma.serproSession.create({
      data: {
        contratante_cnpj: this.cache.contratante_cnpj,
        encrypted_jwt_token: encrypt(this.cache.jwt_token),
        encrypted_access_token: encrypt(this.cache.access_token),
        expires_at: new Date(this.cache.expires_at),
      },
    });
  }

  getCachedJwt(): string | null {
    if (!this.cache) return null;
    if (this.cache.expires_at - 5 * 60_000 < Date.now()) return null;
    return this.cache.jwt_token;
  }

  getCachedAccessToken(): string | null {
    if (!this.cache) return null;
    if (this.cache.expires_at - 5 * 60_000 < Date.now()) return null;
    return this.cache.access_token;
  }

  getCacheStatus() {
    if (!this.cache) return { connected: false };
    const valid = this.cache.expires_at > Date.now();
    return {
      connected: valid,
      contratante_cnpj: this.cache.contratante_cnpj,
      expires_at: new Date(this.cache.expires_at).toISOString(),
      remaining_minutes: Math.max(0, Math.floor((this.cache.expires_at - Date.now()) / 60_000)),
    };
  }

  async clearCache() {
    this.cache = null;
    await this.prisma.serproSession.deleteMany().catch(() => {});
  }

  /**
   * Carrega o A1 da empresa marcada como is_office_account=true.
   * Retorna PFX como Buffer + senha em texto claro (em memória).
   */
  private async loadOfficeCertificate(passwordOverride?: string) {
    const office = await this.prisma.company.findFirst({
      where: { is_office_account: true, metadeleted: false },
    });
    if (!office) {
      throw new NotFoundException(
        'Conta de escritório não cadastrada. Cadastre uma empresa marcando "Esta é a conta do escritório contábil".',
      );
    }

    const cert = await this.prisma.fiscalCertificate.findFirst({
      where: { company_id: office.id, status: 'ACTIVE' },
      orderBy: { valid_to: 'desc' },
    });
    if (!cert) {
      throw new NotFoundException(
        'Certificado A1 do escritório não encontrado. Faça o upload em Fiscal → Certificados A1.',
      );
    }
    if (cert.valid_to < new Date()) {
      throw new BadRequestException('Certificado A1 do escritório está vencido.');
    }

    // O upload original armazena a STRING BASE64 do PFX criptografada como
    // texto via encrypt(). Então fazemos: decrypt() → string base64 → Buffer.
    const pfxBase64 = decrypt(cert.encrypted_pfx_base64);
    const pfxBuffer = Buffer.from(pfxBase64, 'base64');
    const password = passwordOverride ?? decrypt(cert.encrypted_password);

    return { office, cert, pfxBuffer, password };
  }

  /**
   * Converte PFX (PKCS#12) → PEM (cert + chave privada) via node-forge.
   *
   * Necessário porque o Node-OpenSSL não suporta cifras legadas (RC2-40,
   * 3DES) usadas pela maioria dos certificados ICP-Brasil. node-forge aceita
   * essas cifras e gera PEM moderno que o Node consome sem problema.
   */
  private pfxToPem(pfxBuffer: Buffer, password: string): { certPem: string; keyPem: string } {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
      p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, password);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Invalid password') || msg.includes('PKCS#12 MAC')) {
        throw new BadRequestException('Senha do certificado A1 incorreta.');
      }
      throw new BadRequestException(`Falha ao abrir PFX: ${msg}`);
    }

    let privateKey: forge.pki.PrivateKey | null = null;
    let certificate: forge.pki.Certificate | null = null;
    for (const safeContents of p12.safeContents) {
      for (const safeBag of safeContents.safeBags) {
        if (
          (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag)
          && safeBag.key && !privateKey
        ) {
          privateKey = safeBag.key;
        }
        if (safeBag.type === forge.pki.oids.certBag && safeBag.cert && !certificate) {
          certificate = safeBag.cert;
        }
      }
    }
    if (!privateKey) throw new BadRequestException('PFX não contém chave privada.');
    if (!certificate) throw new BadRequestException('PFX não contém certificado.');

    return {
      keyPem: forge.pki.privateKeyToPem(privateKey),
      certPem: forge.pki.certificateToPem(certificate),
    };
  }

  /**
   * Autentica o escritório no Serpro como procurador (Role-Type=TERCEIROS),
   * obtendo access_token + jwt_token via mTLS com o A1 da Valentim.
   */
  async autenticarProcurador(opts: { password?: string } = {}) {
    const passwordFromEnv = process.env.OFFICE_PFX_PASSWORD;
    const password = opts.password ?? passwordFromEnv;
    if (!password) {
      throw new BadRequestException(
        'Senha do PFX não informada. Envie no body como "password" ou defina OFFICE_PFX_PASSWORD no .env.',
      );
    }

    const { office, cert, pfxBuffer } = await this.loadOfficeCertificate(password);
    const cnpjLimpo = office.cnpj.replace(/\D/g, '');

    const consumerKey = process.env.SERPRO_CONSUMER_KEY;
    const consumerSecret = process.env.SERPRO_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) {
      throw new BadRequestException('SERPRO_CONSUMER_KEY/SECRET não configurados.');
    }
    const basicAuth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const authUrl = process.env.SERPRO_AUTH_URL
      ?? 'https://autenticacao.sapi.serpro.gov.br/authenticate';

    // mTLS: o Node-OpenSSL não suporta as cifras (RC2-40, 3DES) usadas pela
    // maioria dos PFX brasileiros. Convertemos para PEM via node-forge (aceita
    // qualquer formato) e passamos cert+key separados para https.Agent.
    const { certPem, keyPem } = this.pfxToPem(pfxBuffer, password);
    const httpsAgent = new https.Agent({
      cert: certPem,
      key: keyPem,
      rejectUnauthorized: true,
    });

    this.logger.log(`Autenticando procurador (mTLS Role-Type=TERCEIROS) para CNPJ ${cnpjLimpo}…`);

    let response;
    try {
      response = await axios.post(authUrl, 'grant_type=client_credentials', {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Role-Type': 'TERCEIROS',
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        httpsAgent,
        timeout: 30_000,
        validateStatus: () => true,
      });
    } catch (err: any) {
      this.logger.error(`Erro de rede no authenticate: ${err.message}`);
      const lower = (err.message || '').toLowerCase();
      if (lower.includes('mac verification') || lower.includes('decryption')) {
        throw new BadRequestException('Senha do PFX incorreta — falhou no handshake mTLS.');
      }
      throw new BadRequestException(`Falha de rede ao autenticar no Serpro: ${err.message}`);
    }

    if (response.status >= 400) {
      const body = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
      this.logger.error(`authenticate status=${response.status} body=${body.slice(0, 500)}`);
      throw new BadRequestException(
        `Serpro recusou autenticação (HTTP ${response.status}): ${body.slice(0, 300)}`,
      );
    }

    const data = response.data ?? {};
    const jwt = data.jwt_token ?? data.jwtToken;
    const accessToken = data.access_token ?? data.accessToken;
    const expiresIn = Number(data.expires_in ?? 3600);

    if (!jwt || !accessToken) {
      this.logger.error(`authenticate sem jwt_token/access_token. body=${JSON.stringify(data).slice(0, 500)}`);
      throw new BadRequestException(
        `Serpro respondeu sem tokens. Resposta: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    const expiresAt = Date.now() + expiresIn * 1000;
    this.cache = {
      jwt_token: jwt,
      access_token: accessToken,
      expires_at: expiresAt,
      contratante_cnpj: cnpjLimpo,
    };
    await this.persistCache();

    this.logger.log(`Procurador autenticado. JWT válido até ${new Date(expiresAt).toISOString()} (${expiresIn}s).`);
    return {
      ok: true,
      contratante_cnpj: cnpjLimpo,
      certificate_holder: cert.holder_name,
      expires_at: new Date(expiresAt).toISOString(),
      expires_in_minutes: Math.floor(expiresIn / 60),
    };
  }
}
