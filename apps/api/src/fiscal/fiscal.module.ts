import {
  Module, Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsBoolean, IsEnum, IsInt, IsNumber, Min, MaxLength, IsDateString,
} from 'class-validator';
import {
  Profile, FiscalProviderType, FiscalDocumentDirection,
  FiscalDocumentType, FiscalDocumentStatus, FiscalCertificateStatus,
  PaymentStatus, PayableSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, ownerBrandIds } from '../financial/tenant.helper';
import { serializeBigInt } from '../financial/money.helper';
import { encrypt, decrypt, encryptBinary, decryptBinary } from './crypto.helper';
import { parseCertificate } from './certificate-parser';
import { createProviderAdapter, NfseDocument, IssueNfseInput } from './providers/plugnotas.adapter';

// =================== DTOs ===================

class UpsertProviderDto {
  @IsString() company_id: string;
  @IsOptional() @IsEnum(FiscalProviderType) type?: FiscalProviderType;
  @IsString() api_key: string;
  @IsOptional() @IsString() api_secret?: string;
  @IsOptional() @IsString() base_url?: string;
  @IsOptional() @IsBoolean() sandbox_mode?: boolean;
  @IsOptional() @IsBoolean() auto_sync_enabled?: boolean;
  @IsOptional() @IsInt() auto_sync_period?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  // Config de emissão NFSe
  @IsOptional() @IsString() @MaxLength(20) issue_codigo_servico?: string;
  @IsOptional() @IsString() @MaxLength(10) issue_cnae?: string;
  @IsOptional() @IsString() @MaxLength(20) issue_inscricao_municipal?: string;
  @IsOptional() issue_iss_aliquota?: number | string;
  @IsOptional() @IsString() @MaxLength(500) issue_descricao_template?: string;
  @IsOptional() @IsString() @MaxLength(20) issue_tomador_cnpj?: string;
  @IsOptional() @IsString() @MaxLength(200) issue_tomador_razao_social?: string;
}

class IssueGgrNfseDto {
  @IsString() ggr_record_id: string;
}

class UploadCertificateDto {
  @IsString() company_id: string;
  @IsString() pfx_base64: string;  // arquivo .pfx em base64
  @IsString() password: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class SyncFiscalDto {
  @IsString() company_id: string;
  @IsOptional() @IsDateString() start_date?: string;
  @IsOptional() @IsDateString() end_date?: string;
  @IsOptional() @IsString() sync_type?: 'manual' | 'auto';
}

class ClaimDocumentDto {
  @IsString() document_number: string;
  @IsString() issuer_cnpj: string;
  /** Valor total em REAIS (ex.: 1234.56). Convertido para centavos no service. */
  @IsNumber() @Min(0) total_amount: number;
  @IsString() brand_id: string;
  /** Quando há múltiplos matches, o segundo POST informa qual NF escolher. */
  @IsOptional() @IsString() pick_document_id?: string;
}

// =================== SERVICE ===================

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Garante que MANAGER só acessa sua empresa */
  private assertCompanyAccess(companyId: string, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
  }

  // ===== Provedor Fiscal =====

  async getProvider(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);

    const provider = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: companyId },
    });
    if (!provider) return null;

    // Não retorna api_key/secret descriptografados — apenas mascarados
    return serializeBigInt({
      ...provider,
      api_key: this.maskKey(provider.api_key),
      api_secret: provider.api_secret ? this.maskKey(provider.api_secret) : null,
    });
  }

  async upsertProvider(dto: UpsertProviderDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);

    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    const data: any = {
      type: dto.type ?? FiscalProviderType.PLUGNOTAS,
      api_key: encrypt(dto.api_key),
      sandbox_mode: dto.sandbox_mode ?? false,
      auto_sync_enabled: dto.auto_sync_enabled ?? true,
      auto_sync_period: dto.auto_sync_period ?? 24,
    };
    if (dto.api_secret) data.api_secret = encrypt(dto.api_secret);
    if (dto.base_url) data.base_url = dto.base_url;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.issue_codigo_servico !== undefined) data.issue_codigo_servico = dto.issue_codigo_servico;
    if (dto.issue_cnae !== undefined) data.issue_cnae = dto.issue_cnae;
    if (dto.issue_inscricao_municipal !== undefined) data.issue_inscricao_municipal = dto.issue_inscricao_municipal;
    if (dto.issue_iss_aliquota !== undefined) data.issue_iss_aliquota = dto.issue_iss_aliquota === '' ? null : Number(dto.issue_iss_aliquota);
    if (dto.issue_descricao_template !== undefined) data.issue_descricao_template = dto.issue_descricao_template;
    if (dto.issue_tomador_cnpj !== undefined) data.issue_tomador_cnpj = dto.issue_tomador_cnpj?.replace(/\D/g, '') || null;
    if (dto.issue_tomador_razao_social !== undefined) data.issue_tomador_razao_social = dto.issue_tomador_razao_social;

    const existing = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: dto.company_id },
    });

    const provider = existing
      ? await this.prisma.fiscalProvider.update({ where: { id: existing.id }, data })
      : await this.prisma.fiscalProvider.create({ data: { ...data, company_id: dto.company_id } });

    await this.audit.log(existing ? 'UPDATE' : 'CREATE', 'FISCAL_PROVIDER', provider.id, current.id);
    return serializeBigInt({ ...provider, api_key: this.maskKey(provider.api_key) });
  }

  async testProviderConnection(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);

    const provider = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: companyId },
    });
    if (!provider) throw new BadRequestException('Provedor não configurado.');

    try {
      const apiKey = decrypt(provider.api_key);
      const adapter = createProviderAdapter(provider.type, apiKey, provider.sandbox_mode);

      // Prefere ping() leve (só valida auth). Se o adapter não implementar,
      // cai pra registerCompany (efeito colateral, mas no pior caso é
      // idempotente).
      if (typeof (adapter as any).ping === 'function') {
        const r = await (adapter as any).ping();
        if (!r.ok) throw new Error(r.message ?? 'Token/API key inválida.');
      } else {
        const company = await this.prisma.company.findUnique({ where: { id: companyId } });
        if (!company) throw new Error('Empresa não encontrada.');
        await adapter.registerCompany({
          cnpj: company.cnpj.replace(/\D/g, ''),
          razao_social: company.name,
          endereco: { municipio: company.city, uf: company.state },
        });
      }

      await this.prisma.fiscalProvider.update({
        where: { id: provider.id },
        data: { last_error: null },
      });
      return { success: true, message: 'Conexão com provedor estabelecida.' };
    } catch (err: any) {
      await this.prisma.fiscalProvider.update({
        where: { id: provider.id },
        data: { last_error: err.message },
      });
      throw new BadRequestException(err.message);
    }
  }

  // ===== Certificados =====

  async listCertificates(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);

    const certs = await this.prisma.fiscalCertificate.findMany({
      where: { company_id: companyId, metadeleted: false },
      orderBy: { created_at: 'desc' },
    });

    // Não retorna o pfx criptografado
    return serializeBigInt(certs.map(c => {
      const { encrypted_pfx_base64, encrypted_password, ...rest } = c;
      return rest;
    }));
  }

  async uploadCertificate(dto: UploadCertificateDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);

    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    // 1. Parseia o certificado para extrair metadados e validar a senha
    let certInfo;
    try {
      certInfo = parseCertificate(dto.pfx_base64, dto.password);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }

    if (certInfo.is_expired) {
      throw new BadRequestException(
        `Certificado expirado em ${certInfo.valid_to.toLocaleDateString('pt-BR')}. Renove antes de usar.`
      );
    }

    // 2. Verifica se o CNPJ do certificado bate com o da empresa
    const companyCnpj = company.cnpj.replace(/\D/g, '');
    if (certInfo.cnpj !== companyCnpj) {
      throw new BadRequestException(
        `CNPJ do certificado (${certInfo.cnpj}) não bate com o da empresa (${companyCnpj}).`
      );
    }

    // 3. Verifica se já existe provedor configurado (opcional).
    // Se ainda não houver provedor, salva apenas localmente e o usuário
    // pode sincronizar depois pelo botão "Sincronizar com provedor".
    const provider = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: dto.company_id },
    });

    let providerCertId: string | null = null;
    let providerWarning: string | null = null;
    if (provider) {
      try {
        const apiKey = decrypt(provider.api_key);
        const adapter = createProviderAdapter(provider.type, apiKey, provider.sandbox_mode);

        await adapter.registerCompany({
          cnpj: companyCnpj,
          razao_social: company.name,
          endereco: { municipio: company.city, uf: company.state },
        });

        const result = await adapter.uploadCertificate({
          cnpj: companyCnpj,
          pfx_base64: dto.pfx_base64,
          password: dto.password,
        });
        providerCertId = result.id;
      } catch (err: any) {
        this.logger.warn('Falha ao sincronizar certificado com provedor — salvando local: ' + err.message);
        providerWarning = err.message;
      }
    } else {
      providerWarning = 'Provedor fiscal ainda não configurado. Certificado salvo apenas localmente.';
    }

    // 5. Marca certificados antigos como inativos
    await this.prisma.fiscalCertificate.updateMany({
      where: {
        company_id: dto.company_id,
        cnpj: certInfo.cnpj,
        metadeleted: false,
        status: FiscalCertificateStatus.ACTIVE,
      },
      data: { status: FiscalCertificateStatus.REVOKED },
    });

    // 6. Salva o certificado no DB com criptografia
    const cert = await this.prisma.fiscalCertificate.create({
      data: {
        cnpj: certInfo.cnpj,
        holder_name: certInfo.holder_name,
        serial_number: certInfo.serial_number,
        issuer: certInfo.issuer,
        valid_from: certInfo.valid_from,
        valid_to: certInfo.valid_to,
        encrypted_pfx_base64: encrypt(dto.pfx_base64),
        encrypted_password: encrypt(dto.password),
        status: FiscalCertificateStatus.ACTIVE,
        provider_certificate_id: providerCertId,
        uploaded_to_provider_at: providerCertId ? new Date() : null,
        last_error: providerWarning,
        notes: dto.notes,
        company_id: dto.company_id,
        provider_id: provider?.id ?? null,
      },
    });

    await this.audit.log('UPLOAD', 'FISCAL_CERTIFICATE', cert.id, current.id, {
      cnpj: certInfo.cnpj,
      valid_to: certInfo.valid_to.toISOString(),
    });

    const { encrypted_pfx_base64, encrypted_password, ...rest } = cert;
    return serializeBigInt(rest);
  }

  /**
   * Faz upload de um certificado já cadastrado no provedor configurado.
   * Útil quando o provedor foi configurado depois do upload do certificado.
   */
  async syncCertificateWithProvider(id: string, current: any) {
    const cert = await this.prisma.fiscalCertificate.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!cert || cert.metadeleted) throw new NotFoundException('Certificado não encontrado.');
    this.assertCompanyAccess(cert.company_id, current);

    const provider = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: cert.company_id },
    });
    if (!provider) throw new BadRequestException('Configure o provedor fiscal primeiro.');

    try {
      const apiKey = decrypt(provider.api_key);
      const adapter = createProviderAdapter(provider.type, apiKey, provider.sandbox_mode);
      const cnpjLimpo = cert.company.cnpj.replace(/\D/g, '');

      // Focus NFe NÃO expõe gerenciamento de empresas via API REST — empresas
      // e A1 são cadastrados pelo painel app-v2.focusnfe.com.br. Para Focus,
      // o "sincronizar" só marca o vínculo no nosso banco; a parte funcional
      // (emissão/consulta) usa a API direto.
      let providerCertId: string | null = null;
      if (provider.type === 'FOCUS_NFE') {
        providerCertId = cnpjLimpo; // Focus indexa por CNPJ
      } else {
        await adapter.registerCompany({
          cnpj: cnpjLimpo,
          razao_social: cert.company.name,
          endereco: { municipio: cert.company.city, uf: cert.company.state },
        });
        const result = await adapter.uploadCertificate({
          cnpj: cnpjLimpo,
          pfx_base64: decrypt(cert.encrypted_pfx_base64),
          password: decrypt(cert.encrypted_password),
        });
        providerCertId = result.id;
      }

      const updated = await this.prisma.fiscalCertificate.update({
        where: { id },
        data: {
          provider_id: provider.id,
          provider_certificate_id: providerCertId,
          uploaded_to_provider_at: new Date(),
          last_error: null,
        },
      });

      await this.audit.log('SYNC_PROVIDER', 'FISCAL_CERTIFICATE', id, current.id);
      const { encrypted_pfx_base64, encrypted_password, ...rest } = updated;
      return rest;
    } catch (err: any) {
      await this.prisma.fiscalCertificate.update({
        where: { id }, data: { last_error: err.message },
      });
      throw new BadRequestException(`Erro no provedor: ${err.message}`);
    }
  }

  async deleteCertificate(id: string, current: any) {
    const cert = await this.prisma.fiscalCertificate.findUnique({ where: { id } });
    if (!cert || cert.metadeleted) throw new NotFoundException('Certificado não encontrado.');
    assertTenantAccess(cert, current);

    await this.prisma.fiscalCertificate.update({
      where: { id },
      data: { metadeleted: true, status: FiscalCertificateStatus.REVOKED },
    });
    await this.audit.log('DELETE', 'FISCAL_CERTIFICATE', id, current.id);
    return { ok: true };
  }

  // ===== Sincronização =====

  /**
   * Busca NFSe do provedor e salva no banco.
   */
  /**
   * Emite uma NFSe da receita do dia (GGR) via PlugNotas.
   * Salva o documento como OUTGOING. Idempotente por GgrDailyRecord.id —
   * se já existe NFSe emitida com a mesma referência, retorna a anterior.
   */
  async issueGgrDailyNfse(ggrRecordId: string, current: any) {
    const ggr = await this.prisma.ggrDailyRecord.findUnique({
      where: { id: ggrRecordId },
      include: { company: true, brand: true },
    });
    if (!ggr || ggr.metadeleted) throw new NotFoundException('Registro GGR não encontrado.');
    this.assertCompanyAccess(ggr.company_id, current);

    if (ggr.ggr <= 0n) {
      throw new BadRequestException('GGR do dia é zero ou negativo — sem receita para emitir.');
    }

    // Idempotência: se já tem NFSe emitida vinculada por raw_response.idIntegracao, retorna.
    const idIntegracao = `ggr-${ggr.id}`;
    const existing = await this.prisma.fiscalDocument.findFirst({
      where: {
        company_id: ggr.company_id,
        direction: FiscalDocumentDirection.OUTGOING,
        document_type: FiscalDocumentType.NFSE,
        provider_document_id: { contains: idIntegracao },
      },
    });
    if (existing && existing.status === FiscalDocumentStatus.AUTHORIZED) {
      return serializeBigInt({ ...existing, message: 'NFSe já emitida anteriormente para este dia.' });
    }

    const provider = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: ggr.company_id },
    });
    if (!provider) throw new BadRequestException('Configure o provedor fiscal primeiro.');
    if (!provider.issue_codigo_servico) {
      throw new BadRequestException('Configure o código do serviço para emissão (Configurar provedor → Emissão).');
    }

    const apiKey = decrypt(provider.api_key);
    const adapter = createProviderAdapter(provider.type, apiKey, provider.sandbox_mode);

    const cnpjLimpo = ggr.company.cnpj.replace(/\D/g, '');
    const valor = Number(ggr.ggr) / 100;
    const dataStr = ggr.date.toISOString().slice(0, 10).split('-').reverse().join('/');
    const descricao = (provider.issue_descricao_template || 'Receita de operação de apostas - {data}')
      .replace('{data}', dataStr)
      .replace('{marca}', ggr.brand?.name ?? '');

    const input: IssueNfseInput = {
      prestador_cnpj: cnpjLimpo,
      prestador_inscricao_municipal: provider.issue_inscricao_municipal ?? undefined,
      tomador_cnpj: provider.issue_tomador_cnpj ?? cnpjLimpo,
      tomador_razao_social: provider.issue_tomador_razao_social ?? ggr.company.name,
      tomador_endereco: {
        logradouro: ggr.company.address ?? undefined,
        municipio: ggr.company.city ?? undefined,
        uf: ggr.company.state ?? undefined,
      },
      codigo_servico: provider.issue_codigo_servico,
      cnae: provider.issue_cnae ?? undefined,
      descricao,
      valor_servicos: valor,
      iss_aliquota: provider.issue_iss_aliquota ? Number(provider.issue_iss_aliquota) : undefined,
      data_emissao: ggr.date,
      id_integracao: idIntegracao,
    };

    const result = await adapter.issueNfse(input);

    const docStatus =
      result.status === 'AUTORIZADA' ? FiscalDocumentStatus.AUTHORIZED :
      result.status === 'REJEITADA' ? FiscalDocumentStatus.REJECTED :
      FiscalDocumentStatus.PENDING;

    const data: any = {
      document_type: FiscalDocumentType.NFSE,
      direction: FiscalDocumentDirection.OUTGOING,
      status: docStatus,

      document_number: result.numero_nfse,
      series: result.serie,
      issue_date: ggr.date,

      issuer_cnpj: cnpjLimpo,
      issuer_name: ggr.company.name,

      recipient_cnpj: provider.issue_tomador_cnpj ?? cnpjLimpo,
      recipient_name: provider.issue_tomador_razao_social ?? ggr.company.name,

      total_amount: BigInt(Math.round(valor * 100)),
      service_amount: BigInt(Math.round(valor * 100)),
      iss_rate: provider.issue_iss_aliquota ? Number(provider.issue_iss_aliquota) : null,
      iss_amount: provider.issue_iss_aliquota ? BigInt(Math.round(valor * Number(provider.issue_iss_aliquota))) : 0n,

      description: descricao,
      service_code: provider.issue_codigo_servico,
      cnae: provider.issue_cnae,

      xml_content: result.xml,
      pdf_url: result.pdf_url,
      provider_document_id: `${result.provider_id}|${idIntegracao}`,
      raw_response: result.raw,

      company_id: ggr.company_id,
      provider_id: provider.id,
    };

    const saved = existing
      ? await this.prisma.fiscalDocument.update({ where: { id: existing.id }, data })
      : await this.prisma.fiscalDocument.create({ data });

    await this.audit.log('ISSUE_NFSE', 'FISCAL_DOCUMENT', saved.id, current.id, { ggr_record_id: ggr.id });
    return serializeBigInt(saved);
  }

  async syncFiscalDocuments(dto: SyncFiscalDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);

    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    const provider = await this.prisma.fiscalProvider.findUnique({
      where: { company_id: dto.company_id },
    });
    if (!provider) throw new BadRequestException('Configure o provedor fiscal primeiro.');

    const activeCert = await this.prisma.fiscalCertificate.findFirst({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        status: FiscalCertificateStatus.ACTIVE,
      },
    });
    if (!activeCert) throw new BadRequestException('Nenhum certificado A1 ativo. Faça upload de um.');

    // Período padrão: últimos 30 dias
    const end_date = dto.end_date ? new Date(dto.end_date) : new Date();
    const start_date = dto.start_date
      ? new Date(dto.start_date)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const startedAt = Date.now();
    let documents_fetched = 0;
    let documents_created = 0;
    let documents_updated = 0;
    let errorMessage: string | null = null;
    let status = 'SUCCESS';

    try {
      const apiKey = decrypt(provider.api_key);
      const adapter = createProviderAdapter(provider.type, apiKey, provider.sandbox_mode);

      const cnpjLimpo = company.cnpj.replace(/\D/g, '');

      // Captura NFSe Tomadas
      const nfseItems = await adapter.fetchIncomingNfse({
        cnpj: cnpjLimpo,
        start_date,
        end_date,
      });
      for (const item of nfseItems) {
        const result = await this.upsertNfseDocument(item, dto.company_id, provider.id);
        if (result === 'created') documents_created++;
        else if (result === 'updated') documents_updated++;
      }
      documents_fetched += nfseItems.length;

      // Captura NFe Recebidas (modelo 55) — apenas se o adapter implementa
      if (typeof (adapter as any).fetchIncomingNfe === 'function') {
        const nfeItems = await (adapter as any).fetchIncomingNfe({
          cnpj: cnpjLimpo,
          start_date,
          end_date,
        });
        for (const item of nfeItems) {
          const result = await this.upsertNfeDocument(item, dto.company_id, provider.id);
          if (result === 'created') documents_created++;
          else if (result === 'updated') documents_updated++;
        }
        documents_fetched += nfeItems.length;
      }

      await this.prisma.fiscalProvider.update({
        where: { id: provider.id },
        data: { last_sync_at: new Date(), last_error: null },
      });
    } catch (err: any) {
      status = 'ERROR';
      errorMessage = err.message ?? 'Erro desconhecido';
      await this.prisma.fiscalProvider.update({
        where: { id: provider.id },
        data: { last_error: errorMessage },
      });
    }

    // Audita
    const log = await this.prisma.fiscalSyncLog.create({
      data: {
        sync_type: dto.sync_type ?? 'manual',
        start_date,
        end_date,
        status,
        documents_fetched,
        documents_created,
        documents_updated,
        error_message: errorMessage,
        duration_ms: Date.now() - startedAt,
        company_id: dto.company_id,
        triggered_by_user_id: current.id,
      },
    });

    if (status === 'ERROR') {
      throw new BadRequestException(errorMessage);
    }

    return serializeBigInt({
      ...log,
      message: documents_fetched === 0
        ? 'Nenhuma nota encontrada no período.'
        : `${documents_created} novas notas + ${documents_updated} atualizadas (de ${documents_fetched} totais)`,
    });
  }

  /**
   * Insere ou atualiza uma NFSe vinda do provedor.
   * Identifica duplicidade por: numero_nota + serie + prestador_cnpj
   */
  private async upsertNfseDocument(
    nfse: NfseDocument,
    companyId: string,
    providerId: string,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    // access_key é @unique GLOBAL — strings vazias geram conflito.
    // Normaliza pra null quando ausente.
    const accessKey = nfse.chave_acesso && nfse.chave_acesso.trim().length > 0
      ? nfse.chave_acesso.trim()
      : null;

    // Tenta encontrar pelo access_key (global), provider_id (global) ou
    // por (numero + prestador) na mesma empresa.
    const existing = await this.prisma.fiscalDocument.findFirst({
      where: {
        OR: [
          ...(accessKey ? [{ access_key: accessKey }] : []),
          ...(nfse.provider_id ? [{ provider_document_id: nfse.provider_id }] : []),
          {
            company_id: companyId,
            document_type: FiscalDocumentType.NFSE,
            issuer_cnpj: nfse.prestador_cnpj,
            document_number: nfse.numero_nota,
          },
        ],
      },
    });

    const data: any = {
      document_type: FiscalDocumentType.NFSE,
      direction: FiscalDocumentDirection.INCOMING,
      status: this.mapDocStatus(nfse.status),

      access_key: accessKey,
      document_number: nfse.numero_nota,
      series: nfse.serie,
      issue_date: nfse.data_emissao,

      issuer_cnpj: nfse.prestador_cnpj,
      issuer_name: nfse.prestador_nome,
      issuer_municipality_code: nfse.prestador_municipio_codigo,

      recipient_cnpj: nfse.tomador_cnpj,
      recipient_name: nfse.tomador_nome,

      total_amount: BigInt(Math.round(nfse.valor_total * 100)),
      service_amount: BigInt(Math.round(nfse.valor_servicos * 100)),
      iss_amount: BigInt(Math.round(nfse.iss_valor * 100)),
      iss_rate: nfse.iss_aliquota,
      irrf_amount: BigInt(Math.round(nfse.irrf_valor * 100)),
      inss_amount: BigInt(Math.round(nfse.inss_valor * 100)),
      pis_amount: BigInt(Math.round(nfse.pis_valor * 100)),
      cofins_amount: BigInt(Math.round(nfse.cofins_valor * 100)),
      csll_amount: BigInt(Math.round(nfse.csll_valor * 100)),

      description: nfse.descricao,
      service_code: nfse.codigo_servico,
      cnae: nfse.cnae,

      xml_content: nfse.xml,
      pdf_url: nfse.pdf_url,
      provider_document_id: nfse.provider_id,
      raw_response: nfse.raw,

      company_id: companyId,
      provider_id: providerId,
    };

    let savedDoc;
    let action: 'created' | 'updated' | 'unchanged';
    if (existing) {
      savedDoc = await this.prisma.fiscalDocument.update({ where: { id: existing.id }, data });
      action = 'updated';
    } else {
      savedDoc = await this.prisma.fiscalDocument.create({ data });
      action = 'created';
    }

    // Auto-vinculação removida — agora exige confirmação manual via
    // POST /fiscal/documents/:id/confirm (após escolha da marca).

    return action;
  }

  /**
   * Upsert de NFe Recebida (modelo 55) — entradas de fornecedores.
   * Match por chave de acesso (que é única no Brasil).
   */
  private async upsertNfeDocument(
    nfe: any /* NfeDocument */,
    companyId: string,
    providerId: string,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const accessKey = nfe.chave_acesso && String(nfe.chave_acesso).trim().length > 0
      ? String(nfe.chave_acesso).trim()
      : null;
    // access_key e provider_document_id são @unique GLOBAIS.
    // Não filtra por company_id no OR pra capturar duplicatas entre empresas.
    const existing = await this.prisma.fiscalDocument.findFirst({
      where: {
        OR: [
          ...(accessKey ? [{ access_key: accessKey }] : []),
          ...(nfe.provider_id ? [{ provider_document_id: nfe.provider_id }] : []),
        ],
      },
    });

    const status =
      nfe.status === 'CANCELADA' ? FiscalDocumentStatus.CANCELLED :
      nfe.status === 'AUTORIZADA' ? FiscalDocumentStatus.AUTHORIZED :
      FiscalDocumentStatus.REJECTED;

    const data: any = {
      document_type: FiscalDocumentType.NFE,
      direction: FiscalDocumentDirection.INCOMING,
      status,

      access_key: accessKey,
      document_number: nfe.numero_nota,
      series: nfe.serie,
      issue_date: nfe.data_emissao,

      issuer_cnpj: nfe.emitente_cnpj,
      issuer_name: nfe.emitente_nome,

      recipient_cnpj: nfe.destinatario_cnpj || null,
      recipient_name: nfe.destinatario_nome,

      total_amount: BigInt(Math.round((nfe.valor_total ?? 0) * 100)),
      products_amount: BigInt(Math.round((nfe.valor_produtos ?? 0) * 100)),
      icms_amount: BigInt(Math.round((nfe.valor_icms ?? 0) * 100)),
      ipi_amount: BigInt(Math.round((nfe.valor_ipi ?? 0) * 100)),
      pis_amount: BigInt(Math.round((nfe.valor_pis ?? 0) * 100)),
      cofins_amount: BigInt(Math.round((nfe.valor_cofins ?? 0) * 100)),

      cfop: nfe.cfop,
      description: nfe.natureza_operacao,
      xml_content: nfe.xml,
      provider_document_id: nfe.provider_id,
      raw_response: nfe.raw,

      company_id: companyId,
      provider_id: providerId,
    };

    let savedDoc;
    let action: 'created' | 'updated' | 'unchanged';
    if (existing) {
      savedDoc = await this.prisma.fiscalDocument.update({ where: { id: existing.id }, data });
      action = 'updated';
    } else {
      savedDoc = await this.prisma.fiscalDocument.create({ data });
      action = 'created';
    }

    // Auto-vinculação removida — exige confirmação manual.
    return action;
  }

  /**
   * Procura uma Conta a Pagar existente que combine com a NFSe (mesmo CNPJ +
   * número de documento OU mesmo valor com data ±5 dias). Se achar, vincula
   * via `matched_payable_id`. Se não achar, cria nova conta a pagar com
   * `source = FISCAL_IMPORT` e vencimento default (emissão + 30 dias).
   */
  private async linkOrCreatePayableFromNfse(
    fiscalDoc: { id: string; total_amount: bigint; service_amount: bigint; issue_date: Date; document_number: string | null; issuer_cnpj: string; issuer_name: string; description: string | null },
    nfse: NfseDocument,
    companyId: string,
  ) {
    const amount = fiscalDoc.service_amount > 0n ? fiscalDoc.service_amount : fiscalDoc.total_amount;
    return this.linkOrCreatePayableFromFiscalDoc(
      { ...fiscalDoc, kind: 'NFSe', amount },
      companyId,
    );
  }

  /**
   * Auto-vínculo de NFe (modelo 55) → AccountPayable.
   * Usa products_amount como base; se 0, cai pro total_amount.
   */
  private async linkOrCreatePayableFromNfe(
    fiscalDoc: { id: string; total_amount: bigint; products_amount?: bigint; issue_date: Date; document_number: string | null; issuer_cnpj: string; issuer_name: string; description: string | null },
    companyId: string,
  ) {
    const products = fiscalDoc.products_amount ?? 0n;
    const amount = products > 0n ? products : fiscalDoc.total_amount;
    return this.linkOrCreatePayableFromFiscalDoc(
      { ...fiscalDoc, kind: 'NFe', amount },
      companyId,
    );
  }

  /**
   * Núcleo comum: encontra AccountPayable compatível ou cria nova.
   * Match: mesmo CNPJ fornecedor + (mesmo número OU mesmo valor em janela ±5 dias).
   */
  private async linkOrCreatePayableFromFiscalDoc(
    doc: {
      id: string; kind: 'NFSe' | 'NFe';
      amount: bigint; issue_date: Date; document_number: string | null;
      issuer_cnpj: string; issuer_name: string; description: string | null;
      brand_id?: string | null;
      contact_id?: string | null;
      account_id?: string | null;
    },
    companyId: string,
  ) {
    const current = await this.prisma.fiscalDocument.findUnique({
      where: { id: doc.id },
      select: { matched_payable_id: true },
    });
    if (current?.matched_payable_id) return;

    const dateFrom = new Date(doc.issue_date); dateFrom.setUTCDate(dateFrom.getUTCDate() - 5);
    const dateTo = new Date(doc.issue_date); dateTo.setUTCDate(dateTo.getUTCDate() + 5);

    const orConds: any[] = [];
    if (doc.document_number) orConds.push({ document_number: doc.document_number });
    orConds.push({ amount: doc.amount, issue_date: { gte: dateFrom, lte: dateTo } });

    const candidate = await this.prisma.accountPayable.findFirst({
      where: {
        company_id: companyId,
        metadeleted: false,
        duplicate_of_id: null,
        supplier_doc: doc.issuer_cnpj,
        OR: orConds,
      },
    });

    if (candidate) {
      // Atualiza dados de classificação no payable existente também
      const candidatePatch: any = {};
      if (doc.brand_id && !candidate.brand_id) candidatePatch.brand_id = doc.brand_id;
      if (doc.contact_id && !candidate.contact_id) candidatePatch.contact_id = doc.contact_id;
      if (doc.account_id && !candidate.account_id) candidatePatch.account_id = doc.account_id;
      if (Object.keys(candidatePatch).length > 0) {
        await this.prisma.accountPayable.update({
          where: { id: candidate.id },
          data: candidatePatch,
        });
      }
      await this.prisma.fiscalDocument.update({
        where: { id: doc.id },
        data: { matched_payable_id: candidate.id, matched_at: new Date(), match_score: 90 },
      });
      return;
    }

    const due = new Date(doc.issue_date);
    due.setUTCDate(due.getUTCDate() + 30);

    const description = doc.description
      ? `${doc.kind} ${doc.document_number ?? ''} · ${doc.description.slice(0, 200)}`
      : `${doc.kind} ${doc.document_number ?? ''} · ${doc.issuer_name}`;

    const payable = await this.prisma.accountPayable.create({
      data: {
        description: description.trim(),
        supplier_name: doc.issuer_name,
        supplier_doc: doc.issuer_cnpj,
        document_number: doc.document_number,
        amount: doc.amount,
        issue_date: doc.issue_date,
        due_date: due,
        status: PaymentStatus.PENDING,
        company_id: companyId,
        brand_id: doc.brand_id ?? null,
        contact_id: doc.contact_id ?? null,
        account_id: doc.account_id ?? null,
        source: PayableSource.FISCAL_IMPORT,
      },
    });
    await this.prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: { matched_payable_id: payable.id, matched_at: new Date(), match_score: 100 },
    });
  }

  private mapDocStatus(s: string): FiscalDocumentStatus {
    switch (s) {
      case 'AUTORIZADA': return FiscalDocumentStatus.AUTHORIZED;
      case 'CANCELADA': return FiscalDocumentStatus.CANCELLED;
      case 'REJEITADA': return FiscalDocumentStatus.REJECTED;
      default: return FiscalDocumentStatus.PENDING;
    }
  }

  // ===== Listagem de documentos fiscais =====

  /** Monta o where compartilhado entre listDocuments e getDocumentStats. */
  private buildDocumentWhere(filters: any, current: any) {
    // OWNER tem acesso só às suas marcas (escopado pelo helper); ADMIN/MANAGER veem tudo da company
    const where = buildTenantWhere(current, {}, { allowOwner: true, ownerScope: 'brand' });
    where.metadeleted = false;

    if (filters.company_id) where.company_id = filters.company_id;
    if (filters.brand_id === 'NONE') where.brand_id = null;
    else if (filters.brand_id) where.brand_id = filters.brand_id;
    // brand_id_in: lista CSV para gestores OWNER multi-marca
    if (filters.brand_id_in && typeof filters.brand_id_in === 'string') {
      const ids = filters.brand_id_in.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (ids.length > 0) where.brand_id = { in: ids };
    }
    if (filters.confirmed === 'pending') where.confirmed_at = null;
    else if (filters.confirmed === 'confirmed') where.confirmed_at = { not: null };
    if (filters.document_type) where.document_type = filters.document_type;
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.issuer_cnpj) where.issuer_cnpj = filters.issuer_cnpj.replace(/\D/g, '');

    if (filters.q && filters.q.trim()) {
      const q = filters.q.trim();
      const cnpjOnly = q.replace(/\D/g, '');
      const orClauses: any[] = [
        { issuer_name: { contains: q, mode: 'insensitive' as const } },
        { recipient_name: { contains: q, mode: 'insensitive' as const } },
        { description: { contains: q, mode: 'insensitive' as const } },
        { document_number: { contains: q, mode: 'insensitive' as const } },
        { access_key: { contains: q.replace(/\D/g, '') } },
      ];
      if (cnpjOnly.length >= 4) {
        orClauses.push({ issuer_cnpj: { contains: cnpjOnly } });
        orClauses.push({ recipient_cnpj: { contains: cnpjOnly } });
      }
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: orClauses }];
        delete where.OR;
      } else {
        where.OR = orClauses;
      }
    }
    if (filters.matched === 'true') where.OR = [{ matched_payable_id: { not: null } }, { matched_receivable_id: { not: null } }];
    if (filters.matched === 'false') where.AND = [{ matched_payable_id: null }, { matched_receivable_id: null }];

    if (filters.start_date || filters.end_date) {
      where.issue_date = {};
      if (filters.start_date) where.issue_date.gte = new Date(filters.start_date);
      if (filters.end_date) where.issue_date.lte = new Date(filters.end_date);
    }
    return where;
  }

  /**
   * Totalizadores das notas filtradas: contagem e valor por (tipo, direção,
   * status de confirmação). Usa os mesmos filtros do listDocuments para que
   * os totais reflitam exatamente o que está visível na lista.
   */
  async getDocumentStats(filters: any, current: any) {
    const where = this.buildDocumentWhere(filters, current);

    const [byTypeDir, byConfirmed, totalAmount] = await Promise.all([
      this.prisma.fiscalDocument.groupBy({
        by: ['document_type', 'direction'],
        where,
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
      this.prisma.fiscalDocument.groupBy({
        by: ['direction'],
        where: { ...where, confirmed_at: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.fiscalDocument.aggregate({
        where,
        _count: { _all: true },
        _sum: { total_amount: true },
      }),
    ]);

    const breakdown = byTypeDir.map((g) => ({
      document_type: g.document_type,
      direction: g.direction,
      count: g._count._all,
      total_amount: g._sum.total_amount ?? 0n,
    }));
    const confirmedByDirection = Object.fromEntries(
      byConfirmed.map((g) => [g.direction, g._count._all]),
    );

    return serializeBigInt({
      total_count: totalAmount._count._all,
      total_amount: totalAmount._sum.total_amount ?? 0n,
      breakdown,
      confirmed_by_direction: confirmedByDirection,
    });
  }

  /**
   * Exporta as notas filtradas para uma planilha Excel (.xlsx).
   * Usa os mesmos filtros do listDocuments, sem paginação. Inclui colunas de
   * status fiscal, valores, retenções e vínculo com conta a pagar — útil pro
   * cliente conferir lote a lote.
   */
  async exportDocumentsXlsx(filters: any, current: any): Promise<{ buffer: Buffer; filename: string }> {
    const where = this.buildDocumentWhere(filters, current);

    const docs = await this.prisma.fiscalDocument.findMany({
      where,
      orderBy: { issue_date: 'desc' },
      include: {
        brand: { select: { name: true } },
        company: { select: { name: true } },
        matched_payable: { select: { id: true, description: true, amount: true, status: true } },
      },
    });

    const fmtBRL = (cents: bigint | number | null | undefined) => {
      if (cents == null) return '';
      const n = typeof cents === 'bigint' ? Number(cents) : cents;
      return (n / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const fmtDate = (d: Date | null | undefined) => d ? new Date(d).toLocaleDateString('pt-BR') : '';
    const fmtCnpj = (c: string | null | undefined) => {
      if (!c) return '';
      const s = c.replace(/\D/g, '');
      if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      return c;
    };

    const rows = docs.map((d: any) => ({
      Empresa: d.company?.name ?? '',
      Marca: d.brand?.name ?? '',
      Tipo: d.document_type === 'NFSE' ? 'NFS-e' : 'NF-e',
      Direção: d.direction === 'INCOMING' ? 'Entrada' : 'Saída',
      'Nº': d.document_number ?? '',
      Série: d.series ?? '',
      'Chave de Acesso': d.access_key ?? '',
      'Data Emissão': fmtDate(d.issue_date),
      'Data Autorização': fmtDate(d.authorization_date),
      Status: d.status,
      Confirmada: d.confirmed_at ? 'Sim' : 'Não',
      'Data Confirmação': fmtDate(d.confirmed_at),
      'CNPJ Emitente': fmtCnpj(d.issuer_cnpj),
      'Nome Emitente': d.issuer_name ?? '',
      UF: d.issuer_state ?? '',
      'CNPJ Destinatário': fmtCnpj(d.recipient_cnpj),
      'Nome Destinatário': d.recipient_name ?? '',
      'Valor Total': fmtBRL(d.total_amount),
      'Valor Serviços': fmtBRL(d.service_amount),
      'Valor Produtos': fmtBRL(d.products_amount),
      ISS: fmtBRL(d.iss_amount),
      'Alíquota ISS': d.iss_rate != null ? String(d.iss_rate) : '',
      IRRF: fmtBRL(d.irrf_amount),
      INSS: fmtBRL(d.inss_amount),
      PIS: fmtBRL(d.pis_amount),
      COFINS: fmtBRL(d.cofins_amount),
      CSLL: fmtBRL(d.csll_amount),
      ICMS: fmtBRL(d.icms_amount),
      IPI: fmtBRL(d.ipi_amount),
      'Código Serviço': d.service_code ?? '',
      CFOP: d.cfop ?? '',
      CNAE: d.cnae ?? '',
      Descrição: d.description ?? '',
      'Conta a Pagar Vinculada': d.matched_payable?.description ?? '',
      'Status Pagamento': d.matched_payable?.status ?? '',
    }));

    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    // Largura automática (aproximada) das colunas
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    ws['!cols'] = headers.map((h) => {
      const maxLen = Math.max(
        h.length,
        ...rows.map((r: any) => String(r[h] ?? '').length),
      );
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Notas Fiscais');

    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().split('T')[0];
    return { buffer, filename: `notas-fiscais-${stamp}.xlsx` };
  }

  async listDocuments(filters: any, current: any) {
    const where = this.buildDocumentWhere(filters, current);

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.fiscalDocument.findMany({
        where,
        orderBy: { issue_date: 'desc' },
        include: {
          matched_payable: { select: { id: true, description: true, amount: true } },
          matched_receivable: { select: { id: true, description: true, amount: true } },
          brand: { select: { id: true, name: true } },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.fiscalDocument.count({ where }),
    ]);

    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async getDocument(id: string, current: any) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id },
      include: {
        matched_payable: true,
        matched_receivable: true,
        brand: { select: { id: true, name: true } },
      },
    });
    if (!doc || doc.metadeleted) throw new NotFoundException('Documento não encontrado.');
    assertTenantAccess(doc, current);
    return serializeBigInt(doc);
  }

  /**
   * Reivindica uma NF do "cofre" (sem marca atribuída) usando 3-fator:
   * número, CNPJ emitente e valor total. Designed para gestores OWNER que
   * não devem enxergar notas alheias — eles precisam *já saber* o trio que
   * prova posse antes de poder ver/marcar a nota como sua.
   *
   * Regras (ver Q1-Q4 do design):
   *  - tolerância ±R$ 0,01 no valor (avisa se houver diferença não-zero)
   *  - rate-limit: 3 falhas em 10min → bloqueia 3min E exige trio diferente
   *  - múltiplos matches → retorna lista (gestor escolhe qual)
   *  - já reivindicada por outra marca → mensagem de contato com admin
   *  - sucesso → roda fluxo `confirmDocument` (cria Contact + ChartOfAccount + AccountPayable)
   */
  async claimDocument(input: {
    document_number: string;
    issuer_cnpj: string;
    total_amount_cents: bigint;
    brand_id: string;
    pick_document_id?: string;  // segundo passo quando há múltiplos matches
  }, current: any) {
    if (current.profile !== Profile.OWNER) {
      throw new BadRequestException('Apenas gestores de marca usam reivindicação. Admin/Manager veem o cofre direto.');
    }
    const allowedBrands = ownerBrandIds(current);
    if (!allowedBrands.includes(input.brand_id)) {
      throw new ForbiddenException('Você não tem permissão para reivindicar nesta marca.');
    }

    const cnpjClean = (input.issuer_cnpj ?? '').replace(/\D/g, '');
    const numberClean = (input.document_number ?? '').trim();
    if (!numberClean) throw new BadRequestException('Informe o número da nota.');
    if (cnpjClean.length < 11) throw new BadRequestException('CNPJ inválido.');
    if (input.total_amount_cents <= 0n) throw new BadRequestException('Valor inválido.');

    // 1) Rate-limit anti-fishing
    await this.assertClaimRateLimit(current.id, {
      number: numberClean,
      cnpj: cnpjClean,
      amount: input.total_amount_cents,
    });

    // 2) Busca matches no banco (com tolerância de ±1 centavo)
    const tolerance = 1n;
    const allMatches = await this.prisma.fiscalDocument.findMany({
      where: {
        metadeleted: false,
        direction: FiscalDocumentDirection.INCOMING,
        status: FiscalDocumentStatus.AUTHORIZED,
        document_number: numberClean,
        issuer_cnpj: cnpjClean,
        total_amount: {
          gte: input.total_amount_cents - tolerance,
          lte: input.total_amount_cents + tolerance,
        },
      },
      orderBy: { issue_date: 'desc' },
    });

    // 3) Filtra: só o que é da empresa do owner (vinculo company)
    const sameCompany = allMatches.filter((d) => d.company_id === current.company_id);
    if (sameCompany.length === 0) {
      await this.recordClaimAttempt(current.id, input, false, 'NOT_FOUND');
      throw new NotFoundException(
        'Nota não encontrada no cofre. Verifique se já foi sincronizada do Qive ou se você reivindicou anteriormente.',
      );
    }

    const claimedByOther = sameCompany.find((d) => d.brand_id && !allowedBrands.includes(d.brand_id));
    const claimedBySelf = sameCompany.find((d) => d.brand_id && allowedBrands.includes(d.brand_id));
    const unclaimed = sameCompany.filter((d) => !d.brand_id);

    if (claimedBySelf && unclaimed.length === 0) {
      await this.recordClaimAttempt(current.id, input, false, 'ALREADY_CLAIMED_SELF');
      throw new BadRequestException('Esta nota já está reivindicada por uma de suas marcas.');
    }

    if (unclaimed.length === 0 && claimedByOther) {
      await this.recordClaimAttempt(current.id, input, false, 'ALREADY_CLAIMED_OTHER');
      throw new BadRequestException(
        'Essa nota já foi reivindicada por outra marca. Entre em contato com o administrador para tratar do assunto.',
      );
    }

    // 4) Múltiplos matches no cofre → 1ª chamada lista, 2ª chamada (com pick_document_id) finaliza
    if (unclaimed.length > 1 && !input.pick_document_id) {
      return {
        multiple: true,
        message: `Foram encontradas ${unclaimed.length} notas com esses dados. Escolha qual reivindicar.`,
        matches: unclaimed.map((d) => ({
          id: d.id,
          issue_date: d.issue_date,
          document_number: d.document_number,
          total_amount: serializeBigInt(d.total_amount),
          description: (d.description ?? '').slice(0, 120),
        })),
      };
    }

    const target = input.pick_document_id
      ? unclaimed.find((d) => d.id === input.pick_document_id)
      : unclaimed[0];

    if (!target) {
      await this.recordClaimAttempt(current.id, input, false, 'PICK_NOT_FOUND');
      throw new BadRequestException('Nota selecionada não está mais disponível no cofre.');
    }

    // 5) Atribui marca, registra audit e roda fluxo de confirmação
    await this.prisma.fiscalDocument.update({
      where: { id: target.id },
      data: { brand_id: input.brand_id },
    });

    await this.audit.log('CLAIM', 'FISCAL_DOCUMENT', target.id, current.id, {
      brand_id: input.brand_id,
      document_number: numberClean,
      issuer_cnpj: cnpjClean,
      amount_informed: input.total_amount_cents.toString(),
      amount_actual: target.total_amount.toString(),
    });

    // Roda confirmação automática (Contact + ChartOfAccount + AccountPayable)
    const confirmed = await this.confirmDocument(target.id, current);

    await this.recordClaimAttempt(current.id, input, true, null);

    const amountDiff = target.total_amount - input.total_amount_cents;
    return {
      success: true,
      document: confirmed,
      amount_diff_cents: amountDiff !== 0n ? Number(amountDiff) : 0,
      amount_diff_warning: amountDiff !== 0n
        ? `Atenção: a nota tem ${this.formatBRL(target.total_amount)} (R$ ${(Number(amountDiff)/100).toFixed(2).replace('.', ',')} de diferença em relação ao valor informado).`
        : null,
    };
  }

  /** Throw se o usuário estiver bloqueado por rate-limit. */
  private async assertClaimRateLimit(
    userId: string,
    trio: { number: string; cnpj: string; amount: bigint },
  ) {
    const since = new Date(Date.now() - 10 * 60 * 1000); // 10 min
    const recent = await this.prisma.fiscalClaimAttempt.findMany({
      where: { user_id: userId, attempted_at: { gte: since } },
      orderBy: { attempted_at: 'desc' },
    });
    const recentFails = recent.filter((a) => !a.success);
    if (recentFails.length < 3) return;

    const lastFailure = recentFails[0].attempted_at;
    const blockUntil = new Date(lastFailure.getTime() + 3 * 60 * 1000);
    if (Date.now() < blockUntil.getTime()) {
      // Verifica se o trio atual é igual a alguma falha recente — se for, bloqueia
      const repeated = recentFails.some((a) =>
        a.document_number === trio.number &&
        a.issuer_cnpj === trio.cnpj &&
        a.total_amount_cents === trio.amount,
      );
      if (repeated) {
        const waitSec = Math.ceil((blockUntil.getTime() - Date.now()) / 1000);
        throw new BadRequestException(
          `Você atingiu o limite de tentativas. Tente uma nota DIFERENTE ou aguarde ${waitSec}s para tentar novamente este mesmo trio.`,
        );
      }
    }
  }

  private async recordClaimAttempt(
    userId: string,
    input: { document_number: string; issuer_cnpj: string; total_amount_cents: bigint; brand_id: string },
    success: boolean,
    failureReason: string | null,
  ) {
    try {
      await this.prisma.fiscalClaimAttempt.create({
        data: {
          user_id: userId,
          brand_id: input.brand_id,
          document_number: input.document_number,
          issuer_cnpj: (input.issuer_cnpj ?? '').replace(/\D/g, ''),
          total_amount_cents: input.total_amount_cents,
          success,
          failure_reason: failureReason,
        },
      });
    } catch (e: any) {
      // Não falha o fluxo principal por erro de log
      this.logger.warn(`Falha ao gravar claim attempt: ${e?.message}`);
    }
  }

  private formatBRL(cents: bigint): string {
    return `R$ ${(Number(cents) / 100).toFixed(2).replace('.', ',')}`;
  }

  /**
   * Lista as NFs reivindicadas pelo gestor (filtrado por marcas atribuídas).
   * Para Admin/Manager retorna lista normal (reusa filtros de listDocuments).
   */
  async listMyClaimedDocuments(current: any, filters: any = {}) {
    if (current.profile !== Profile.OWNER) {
      return this.listDocuments(filters, current);
    }
    const brandIds = ownerBrandIds(current);
    if (brandIds.length === 0) {
      return { data: [], total: 0, page: 1, per_page: 50 };
    }
    return this.listDocuments({ ...filters, brand_id_in: brandIds.join(',') }, current);
  }

  /**
   * Confirma manualmente uma NF Entrada: vincula/cria AccountPayable, cadastra
   * fornecedor (Contact) e cria conta no plano de contas sob a marca.
   * Exige marca operacional escolhida.
   */
  async confirmDocument(id: string, current: any) {
    const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
    if (!doc || doc.metadeleted) throw new NotFoundException('Nota não encontrada.');
    // OWNER autoriza por marca (já validamos brand_id antes via claim).
    assertTenantAccess(doc, current, { allowOwner: true, ownerScope: 'brand' });

    if (doc.direction !== FiscalDocumentDirection.INCOMING) {
      throw new BadRequestException('Apenas NF Entrada pode ser confirmada.');
    }
    if (doc.status !== FiscalDocumentStatus.AUTHORIZED) {
      throw new BadRequestException('Apenas notas AUTORIZADAS podem ser confirmadas.');
    }
    if (!doc.brand_id) {
      throw new BadRequestException('Selecione a marca operacional antes de confirmar.');
    }
    if (doc.confirmed_at) {
      throw new BadRequestException('Esta nota já está confirmada.');
    }
    if (!doc.issuer_cnpj) {
      throw new BadRequestException('Nota sem CNPJ do emitente — não dá pra criar conta a pagar.');
    }

    // 1) Cadastra/encontra Contact do fornecedor
    const contact = await this.ensureSupplierContact(doc.company_id, {
      name: doc.issuer_name,
      document: doc.issuer_cnpj,
    });

    // 2) Cadastra/encontra conta no plano de contas sob a marca
    const supplierAccount = await this.ensureSupplierAccountForBrand(
      doc.company_id,
      doc.brand_id,
      contact,
    );

    // 3) Cria/vincula AccountPayable
    const amount =
      doc.document_type === FiscalDocumentType.NFSE
        ? (doc.service_amount > 0n ? doc.service_amount : doc.total_amount)
        : (doc.products_amount > 0n ? doc.products_amount : doc.total_amount);

    await this.linkOrCreatePayableFromFiscalDoc({
      id: doc.id,
      kind: doc.document_type === FiscalDocumentType.NFSE ? 'NFSe' : 'NFe',
      amount,
      issue_date: doc.issue_date,
      document_number: doc.document_number,
      issuer_cnpj: doc.issuer_cnpj,
      issuer_name: doc.issuer_name,
      description: doc.description,
      brand_id: doc.brand_id,
      contact_id: contact.id,
      account_id: supplierAccount.id,
    } as any, doc.company_id);

    const updated = await this.prisma.fiscalDocument.update({
      where: { id },
      data: { confirmed_at: new Date(), confirmed_by_user_id: current.id },
      include: {
        matched_payable: true,
        matched_receivable: true,
        brand: { select: { id: true, name: true } },
      },
    });
    await this.audit.log('CONFIRM', 'FISCAL_DOCUMENT', id, current.id);
    return serializeBigInt(updated);
  }

  /**
   * Cadastra (ou encontra) um fornecedor pelo CNPJ na empresa.
   * Limpa o nome de prefixos comuns como o CNPJ MEI ("60.896.427 LUYD ...").
   */
  private async ensureSupplierContact(
    companyId: string,
    data: { name: string; document: string },
  ) {
    const cleanDoc = (data.document ?? '').replace(/\D/g, '');
    const cleanName = this.cleanSupplierName(data.name);

    if (cleanDoc) {
      const existing = await this.prisma.contact.findFirst({
        where: { company_id: companyId, document: cleanDoc, metadeleted: false },
      });
      if (existing) {
        if (!existing.is_supplier) {
          await this.prisma.contact.update({
            where: { id: existing.id },
            data: { is_supplier: true },
          });
        }
        return existing;
      }
    }
    return this.prisma.contact.create({
      data: {
        person_type: 'COMPANY',
        name: cleanName || 'Fornecedor sem nome',
        document: cleanDoc || null,
        is_supplier: true,
        company_id: companyId,
      },
    });
  }

  private cleanSupplierName(name: string): string {
    if (!name) return '';
    // Remove prefixos tipo "60.896.427 NOME" ou "60896427 NOME" — comum em
    // NFSe de MEI onde a prefeitura prefixa o CNPJ na razão social.
    return name.replace(/^[\d.\-\/]+\s+/, '').trim();
  }

  /**
   * Garante que existe a estrutura no plano de contas:
   *   5.M  "Centros de Custo (Marcas)"
   *   5.M.<seq>  <nome da marca>
   *   5.M.<seq>.<sub>  <nome do fornecedor>
   *
   * Retorna a conta-folha do fornecedor (a que será linkada na AccountPayable).
   */
  private async ensureSupplierAccountForBrand(
    companyId: string,
    brandId: string,
    contact: { id: string; name: string; document: string | null },
  ) {
    // 1) Conta-mãe "5" DESPESAS — assume que o seed default já criou (5).
    const despesasRoot = await this.prisma.chartOfAccount.findUnique({
      where: { company_id_code: { company_id: companyId, code: '5' } },
    });
    if (!despesasRoot) {
      throw new BadRequestException(
        'Plano de contas sem a raiz "5 - DESPESAS". Configure o plano de contas padrão da empresa.',
      );
    }

    // 2) Conta "5.M" Centros de Custo (Marcas) — cria se não existe
    let mRoot = await this.prisma.chartOfAccount.findUnique({
      where: { company_id_code: { company_id: companyId, code: '5.M' } },
    });
    if (!mRoot) {
      mRoot = await this.prisma.chartOfAccount.create({
        data: {
          code: '5.M',
          name: 'Centros de Custo (Marcas)',
          type: 'EXPENSE',
          parent_id: despesasRoot.id,
          company_id: companyId,
        },
      });
    }

    // 3) Conta da marca: 5.M.<seq>
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new BadRequestException('Marca não encontrada.');

    let brandAccount = await this.prisma.chartOfAccount.findFirst({
      where: {
        company_id: companyId,
        parent_id: mRoot.id,
        name: brand.name,
        metadeleted: false,
      },
    });
    if (!brandAccount) {
      const brandSiblings = await this.prisma.chartOfAccount.findMany({
        where: { company_id: companyId, parent_id: mRoot.id },
        select: { code: true },
      });
      const brandSeq = this.nextChildSeq(mRoot.code, brandSiblings.map(b => b.code));
      brandAccount = await this.prisma.chartOfAccount.create({
        data: {
          code: brandSeq,
          name: brand.name,
          type: 'EXPENSE',
          parent_id: mRoot.id,
          company_id: companyId,
        },
      });
    }

    // 4) Conta do fornecedor sob a marca
    let supplierAccount = await this.prisma.chartOfAccount.findFirst({
      where: {
        company_id: companyId,
        parent_id: brandAccount.id,
        name: contact.name,
        metadeleted: false,
      },
    });
    if (!supplierAccount) {
      const supplierSiblings = await this.prisma.chartOfAccount.findMany({
        where: { company_id: companyId, parent_id: brandAccount.id },
        select: { code: true },
      });
      const supplierSeq = this.nextChildSeq(brandAccount.code, supplierSiblings.map(s => s.code));
      supplierAccount = await this.prisma.chartOfAccount.create({
        data: {
          code: supplierSeq,
          name: contact.name,
          description: contact.document
            ? `Fornecedor CNPJ ${contact.document}`
            : 'Fornecedor (auto-cadastrado pela importação fiscal)',
          type: 'EXPENSE',
          parent_id: brandAccount.id,
          company_id: companyId,
        },
      });
    }
    return supplierAccount;
  }

  /**
   * Gera o próximo código sequencial dentro de um pai.
   * Ex.: parent="5.M", siblings=["5.M.01", "5.M.02"] → "5.M.03"
   */
  private nextChildSeq(parentCode: string, siblingCodes: string[]): string {
    const prefix = `${parentCode}.`;
    const usedSeqs = siblingCodes
      .filter(c => c.startsWith(prefix))
      .map(c => c.slice(prefix.length).split('.')[0])
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n));
    const next = usedSeqs.length === 0 ? 1 : Math.max(...usedSeqs) + 1;
    return `${parentCode}.${String(next).padStart(2, '0')}`;
  }

  /**
   * Desfaz a confirmação. Se a AccountPayable foi criada via FISCAL_IMPORT,
   * marca como deletada (soft-delete). Em qualquer caso solta o vínculo
   * e zera confirmed_at, devolvendo a nota pra "NF Entradas".
   */
  async unconfirmDocument(id: string, current: any) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id },
      include: { matched_payable: true },
    });
    if (!doc || doc.metadeleted) throw new NotFoundException('Nota não encontrada.');
    assertTenantAccess(doc, current);

    if (doc.matched_payable) {
      const payable = doc.matched_payable;
      // Só apaga se foi criada via FISCAL_IMPORT (não toca em payables que o
      // financeiro registrou manualmente — esses só desvinculam).
      if (payable.source === PayableSource.FISCAL_IMPORT) {
        await this.prisma.accountPayable.update({
          where: { id: payable.id },
          data: { metadeleted: true },
        });
      }
    }

    const updated = await this.prisma.fiscalDocument.update({
      where: { id },
      data: {
        confirmed_at: null,
        confirmed_by_user_id: null,
        matched_payable_id: null,
        matched_at: null,
        match_score: null,
      },
      include: {
        matched_payable: true,
        matched_receivable: true,
        brand: { select: { id: true, name: true } },
      },
    });
    await this.audit.log('UNCONFIRM', 'FISCAL_DOCUMENT', id, current.id);
    return serializeBigInt(updated);
  }

  /**
   * Backfill: percorre FiscalDocuments INCOMING+AUTHORIZED sem
   * matched_payable_id e tenta vincular/criar AccountPayable usando a mesma
   * lógica que roda no upsert.
   */
  async backfillPayables(companyId: string | undefined, current: any) {
    if (companyId) this.assertCompanyAccess(companyId, current);

    const where: any = {
      direction: FiscalDocumentDirection.INCOMING,
      status: FiscalDocumentStatus.AUTHORIZED,
      matched_payable_id: null,
      metadeleted: false,
    };
    if (companyId) where.company_id = companyId;

    const docs = await this.prisma.fiscalDocument.findMany({ where });

    let processed = 0, linked = 0, errors = 0;
    for (const d of docs) {
      try {
        if (d.document_type === FiscalDocumentType.NFSE) {
          if (!d.issuer_cnpj) { processed++; continue; }
          await this.linkOrCreatePayableFromFiscalDoc({
            id: d.id,
            kind: 'NFSe',
            amount: d.service_amount > 0n ? d.service_amount : d.total_amount,
            issue_date: d.issue_date,
            document_number: d.document_number,
            issuer_cnpj: d.issuer_cnpj,
            issuer_name: d.issuer_name,
            description: d.description,
          }, d.company_id);
        } else if (d.document_type === FiscalDocumentType.NFE) {
          if (!d.issuer_cnpj) { processed++; continue; }
          await this.linkOrCreatePayableFromFiscalDoc({
            id: d.id,
            kind: 'NFe',
            amount: d.products_amount > 0n ? d.products_amount : d.total_amount,
            issue_date: d.issue_date,
            document_number: d.document_number,
            issuer_cnpj: d.issuer_cnpj,
            issuer_name: d.issuer_name,
            description: d.description,
          }, d.company_id);
        }
        const fresh = await this.prisma.fiscalDocument.findUnique({
          where: { id: d.id },
          select: { matched_payable_id: true },
        });
        if (fresh?.matched_payable_id) linked++;
        processed++;
      } catch (err: any) {
        this.logger.warn(`Backfill ${d.id}: ${err?.message ?? err}`);
        errors++;
      }
    }

    return { ok: true, processed, linked, errors, total: docs.length };
  }

  /**
   * Dashboard fiscal: agregados por mês para uma empresa (ou todas).
   * Retorna:
   *   - totals: total entrada, total saída, ISS retido, IRRF retido,
   *             INSS retido, contagem de notas por tipo/direção
   *   - byMonth: série temporal últimos 12 meses
   *   - topSuppliers: 10 maiores fornecedores (entrada) por valor
   */
  async getDashboard(filters: { company_id?: string; brand_id?: string }, current: any) {
    const where: any = { metadeleted: false, status: FiscalDocumentStatus.AUTHORIZED };
    if (filters.company_id) {
      this.assertCompanyAccess(filters.company_id, current);
      where.company_id = filters.company_id;
    } else if (current.profile === Profile.MANAGER && current.company_id) {
      where.company_id = current.company_id;
    }
    if (filters.brand_id) where.brand_id = filters.brand_id;

    // Janela: últimos 12 meses
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    where.issue_date = { gte: twelveMonthsAgo };

    const docs = await this.prisma.fiscalDocument.findMany({
      where,
      select: {
        id: true,
        document_type: true,
        direction: true,
        issue_date: true,
        total_amount: true,
        service_amount: true,
        iss_amount: true,
        irrf_amount: true,
        inss_amount: true,
        pis_amount: true,
        cofins_amount: true,
        csll_amount: true,
        issuer_cnpj: true,
        issuer_name: true,
      },
    });

    // Agregação por mês (YYYY-MM)
    const byMonth: Record<string, any> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = {
        month: key,
        entrada: 0,
        saida: 0,
        iss_retido: 0,
        irrf_retido: 0,
        inss_retido: 0,
        notas_entrada: 0,
        notas_saida: 0,
      };
    }

    let totalEntrada = 0n, totalSaida = 0n;
    let issRetido = 0n, irrfRetido = 0n, inssRetido = 0n;
    let pisRetido = 0n, cofinsRetido = 0n, csllRetido = 0n;
    let notasEntrada = 0, notasSaida = 0;
    let nfseEntrada = 0, nfeEntrada = 0, nfseSaida = 0;
    const supplierTotals: Record<string, { cnpj: string; name: string; total: bigint; count: number }> = {};

    for (const d of docs) {
      const key = `${d.issue_date.getFullYear()}-${String(d.issue_date.getMonth() + 1).padStart(2, '0')}`;
      const m = byMonth[key];
      const valor = Number(d.total_amount) / 100;

      if (d.direction === 'INCOMING') {
        totalEntrada += d.total_amount;
        notasEntrada++;
        if (d.document_type === 'NFSE') nfseEntrada++;
        if (d.document_type === 'NFE') nfeEntrada++;
        if (m) { m.entrada += valor; m.notas_entrada += 1; }

        // Top fornecedores
        if (d.issuer_cnpj) {
          if (!supplierTotals[d.issuer_cnpj]) {
            supplierTotals[d.issuer_cnpj] = { cnpj: d.issuer_cnpj, name: d.issuer_name, total: 0n, count: 0 };
          }
          supplierTotals[d.issuer_cnpj].total += d.total_amount;
          supplierTotals[d.issuer_cnpj].count += 1;
        }
      } else {
        totalSaida += d.total_amount;
        notasSaida++;
        if (d.document_type === 'NFSE') nfseSaida++;
        if (m) { m.saida += valor; m.notas_saida += 1; }
      }

      issRetido += d.iss_amount;
      irrfRetido += d.irrf_amount;
      inssRetido += d.inss_amount;
      pisRetido += d.pis_amount;
      cofinsRetido += d.cofins_amount;
      csllRetido += d.csll_amount;

      if (m) {
        m.iss_retido += Number(d.iss_amount) / 100;
        m.irrf_retido += Number(d.irrf_amount) / 100;
        m.inss_retido += Number(d.inss_amount) / 100;
      }
    }

    const topSuppliers = Object.values(supplierTotals)
      .sort((a, b) => Number(b.total - a.total))
      .slice(0, 10)
      .map(s => ({ cnpj: s.cnpj, name: s.name, total: s.total.toString(), count: s.count }));

    return serializeBigInt({
      totals: {
        total_entrada: totalEntrada,
        total_saida: totalSaida,
        iss_retido: issRetido,
        irrf_retido: irrfRetido,
        inss_retido: inssRetido,
        pis_retido: pisRetido,
        cofins_retido: cofinsRetido,
        csll_retido: csllRetido,
        notas_entrada: notasEntrada,
        notas_saida: notasSaida,
        nfse_entrada: nfseEntrada,
        nfe_entrada: nfeEntrada,
        nfse_saida: nfseSaida,
      },
      by_month: Object.values(byMonth),
      top_suppliers: topSuppliers,
    });
  }

  /**
   * Lista eventos de manifestação SEFAZ de uma NFe (Ciência, Confirmação,
   * Desconhecimento, Operação Não Realizada). Disponível pra Qive.
   */
  async getDocumentEvents(id: string, current: any) {
    const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
    if (!doc || doc.metadeleted) throw new NotFoundException('Documento não encontrado.');
    assertTenantAccess(doc, current);

    if (doc.document_type !== 'NFE') {
      return { events: [], note: 'Manifestação SEFAZ só se aplica a NFe (modelo 55).' };
    }
    if (!doc.access_key) {
      return { events: [], note: 'Esta NFe não tem chave de acesso registrada.' };
    }

    const provider = await this.prisma.fiscalProvider.findFirst({
      where: { company_id: doc.company_id, metadeleted: false, is_active: true },
    });
    if (!provider) {
      return { events: [], note: 'Provedor fiscal não configurado.' };
    }

    const apiKey = decrypt(provider.api_key);
    const adapter: any = createProviderAdapter(provider.type, apiKey, provider.sandbox_mode);

    if (typeof adapter.fetchNfeEvents !== 'function') {
      return { events: [], note: `Provedor ${provider.type} não expõe consulta de eventos NFe.` };
    }

    try {
      const events = await adapter.fetchNfeEvents(doc.access_key);
      return { events, note: events.length === 0 ? 'Nenhum evento de manifestação registrado.' : undefined };
    } catch (err: any) {
      return { events: [], error: err.message };
    }
  }

  /**
   * Atualiza a marca vinculada a uma nota. Valida que a marca pertence
   * à mesma empresa da nota (não dá pra associar uma NFSe da Pixbet a uma
   * marca da Selectbet).
   */
  async updateDocumentBrand(id: string, brandId: string | null, current: any) {
    const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
    if (!doc || doc.metadeleted) throw new NotFoundException('Documento não encontrado.');
    assertTenantAccess(doc, current);

    if (brandId) {
      const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
      if (!brand || brand.metadeleted) throw new BadRequestException('Marca não encontrada.');
      if (brand.company_id !== doc.company_id) {
        throw new BadRequestException('A marca selecionada pertence a outra empresa.');
      }
    }

    const updated = await this.prisma.fiscalDocument.update({
      where: { id },
      data: { brand_id: brandId },
      include: {
        matched_payable: true,
        matched_receivable: true,
        brand: { select: { id: true, name: true } },
      },
    });
    await this.audit.log('UPDATE', 'FISCAL_DOCUMENT', id, current.id);
    return serializeBigInt(updated);
  }

  // ===== Logs de sincronização =====

  async listSyncLogs(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);
    const logs = await this.prisma.fiscalSyncLog.findMany({
      where: { company_id: companyId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return serializeBigInt({ data: logs, total: logs.length });
  }

  // ===== Helper =====

  private maskKey(encryptedKey: string): string {
    try {
      const decrypted = decrypt(encryptedKey);
      const len = decrypted.length;
      if (len <= 8) return '••••••••';
      return decrypted.substring(0, 4) + '•'.repeat(len - 8) + decrypted.substring(len - 4);
    } catch {
      return '••••••••';
    }
  }
}

// =================== CONTROLLER ===================

@ApiTags('fiscal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('fiscal')
export class FiscalController {
  constructor(private service: FiscalService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('provider/:companyId')
  getProvider(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.getProvider(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('provider')
  upsertProvider(@Body() dto: UpsertProviderDto, @CurrentUser() user: any) {
    return this.service.upsertProvider(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('provider/:companyId/test')
  testConnection(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.testProviderConnection(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('certificates/:companyId')
  listCertificates(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listCertificates(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('certificates')
  uploadCertificate(@Body() dto: UploadCertificateDto, @CurrentUser() user: any) {
    return this.service.uploadCertificate(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('certificates/:id/sync-provider')
  syncCertProvider(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.syncCertificateWithProvider(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete('certificates/:id')
  deleteCertificate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteCertificate(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('sync')
  sync(@Body() dto: SyncFiscalDto, @CurrentUser() user: any) {
    return this.service.syncFiscalDocuments(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('issue/ggr-daily')
  issueGgrDaily(@Body() dto: IssueGgrNfseDto, @CurrentUser() user: any) {
    return this.service.issueGgrDailyNfse(dto.ggr_record_id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents')
  listDocuments(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listDocuments(q, user);
  }

  /** Totalizadores das notas (mesmos filtros da lista, sem paginação). */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents-stats')
  getDocumentStats(@Query() q: any, @CurrentUser() user: any) {
    return this.service.getDocumentStats(q, user);
  }

  /** Exporta notas filtradas em Excel (.xlsx) — para conferência do cliente. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents-export')
  async exportDocuments(@Query() q: any, @CurrentUser() user: any, @Res() res: Response) {
    const { buffer, filename } = await this.service.exportDocumentsXlsx(q, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents/:id')
  getDocument(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getDocument(id, user);
  }

  /** Dashboard fiscal: agregados últimos 12 meses + top fornecedores. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('dashboard')
  getDashboard(@Query() q: any, @CurrentUser() user: any) {
    return this.service.getDashboard(
      { company_id: q.company_id, brand_id: q.brand_id },
      user,
    );
  }

  /**
   * Backfill: tenta vincular ou criar AccountPayable pra todas as NFSe/NFe
   * INCOMING+AUTHORIZED que ainda não têm matched_payable_id.
   * Útil quando a empresa tinha notas antes da feature de auto-link estar ativa.
   */
  @Profiles(Profile.ADMIN)
  @Post('backfill/payables')
  backfillPayables(
    @Body() body: { company_id?: string },
    @CurrentUser() user: any,
  ) {
    return this.service.backfillPayables(body?.company_id, user);
  }

  /** Atribui (ou remove) a marca operacional ligada a uma nota fiscal. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch('documents/:id')
  updateDocument(
    @Param('id') id: string,
    @Body() dto: { brand_id?: string | null },
    @CurrentUser() user: any,
  ) {
    return this.service.updateDocumentBrand(id, dto.brand_id ?? null, user);
  }

  /**
   * Confirma uma NF Entrada: vincula/cria a AccountPayable e marca como
   * confirmada. Exige que a marca operacional já esteja escolhida.
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('documents/:id/confirm')
  confirmDocument(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.confirmDocument(id, user);
  }

  /**
   * Reivindicação 3-fator: gestor OWNER busca uma NF do cofre informando
   * número, CNPJ emitente e valor. Após sucesso, a nota recebe a marca
   * dele e o fluxo de confirmação roda automaticamente.
   */
  @Profiles(Profile.OWNER)
  @Post('documents/claim')
  claimDocument(@Body() dto: ClaimDocumentDto, @CurrentUser() user: any) {
    return this.service.claimDocument({
      document_number: dto.document_number,
      issuer_cnpj: dto.issuer_cnpj,
      total_amount_cents: BigInt(Math.round(dto.total_amount * 100)),
      brand_id: dto.brand_id,
      pick_document_id: dto.pick_document_id,
    }, user);
  }

  /** Lista as NFs já reivindicadas pelo gestor OWNER (filtradas por suas marcas). */
  @Profiles(Profile.OWNER, Profile.ADMIN, Profile.MANAGER)
  @Get('my-documents')
  listMyDocuments(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listMyClaimedDocuments(user, q);
  }

  /**
   * Desfaz a confirmação: solta a AccountPayable (e soft-delete se foi
   * criada via FISCAL_IMPORT) e devolve a nota pra "NF Entradas".
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('documents/:id/unconfirm')
  unconfirmDocument(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.unconfirmDocument(id, user);
  }

  /**
   * Eventos NFe (manifestação do destinatário registrada via SEFAZ).
   * Só funciona pra NFe (modelo 55) e exige provedor que exponha esse
   * endpoint (atualmente: Qive).
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents/:id/events')
  getDocumentEvents(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getDocumentEvents(id, user);
  }

  /** Download do XML cru da nota (para arquivamento ou import em outro sistema) */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents/:id/xml')
  async downloadDocumentXml(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const doc = await this.service.getDocument(id, user);
    if (!doc.xml_content) throw new BadRequestException('Esta nota não possui XML salvo.');

    const docNumber = doc.document_number ?? doc.id;
    const docType = doc.document_type === 'NFE' ? 'nfe' : 'nfse';
    const filename = `${docType}_${docNumber}_${doc.issuer_cnpj}.xml`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.removeHeader('ETag');
    res.end(doc.xml_content);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('sync-logs/:companyId')
  syncLogs(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listSyncLogs(companyId, user);
  }
}

import { ScheduleModule } from '@nestjs/schedule';
import { FiscalCronService } from './fiscal-cron.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [FiscalController],
  providers: [FiscalService, FiscalCronService],
  exports: [FiscalService],
})
export class FiscalModule {}
