import {
  Module, Injectable, NotFoundException, BadRequestException, Logger,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsBoolean, IsEnum, IsInt, MaxLength, IsDateString,
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
import { buildTenantWhere, assertTenantAccess } from '../financial/tenant.helper';
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

      // Tenta uma operação simples (registrar a empresa - se já existir, retorna OK)
      const company = await this.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) throw new Error('Empresa não encontrada.');

      await adapter.registerCompany({
        cnpj: company.cnpj.replace(/\D/g, ''),
        razao_social: company.name,
        endereco: {
          municipio: company.city,
          uf: company.state,
        },
      });

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

      const updated = await this.prisma.fiscalCertificate.update({
        where: { id },
        data: {
          provider_id: provider.id,
          provider_certificate_id: result.id,
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
      const items = await adapter.fetchIncomingNfse({
        cnpj: cnpjLimpo,
        start_date,
        end_date,
      });

      documents_fetched = items.length;

      for (const item of items) {
        const result = await this.upsertNfseDocument(item, dto.company_id, provider.id);
        if (result === 'created') documents_created++;
        else if (result === 'updated') documents_updated++;
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
        sync_type: 'manual',
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
    // Tenta encontrar pelo provider_id ou por (numero + prestador)
    const existing = await this.prisma.fiscalDocument.findFirst({
      where: {
        company_id: companyId,
        OR: [
          ...(nfse.provider_id ? [{ provider_document_id: nfse.provider_id }] : []),
          {
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

      access_key: nfse.chave_acesso,
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

    // === Auto-vinculação / criação de Conta a Pagar a partir da NFSe AUTORIZADA ===
    // Só dispara para notas INCOMING (recebidas pela empresa) e AUTORIZADAS.
    if (
      savedDoc.direction === FiscalDocumentDirection.INCOMING
      && savedDoc.status === FiscalDocumentStatus.AUTHORIZED
      && nfse.prestador_cnpj
    ) {
      try {
        await this.linkOrCreatePayableFromNfse(savedDoc, nfse, companyId);
      } catch (e: any) {
        this.logger.warn(`Falha ao vincular/criar payable da NFSe ${savedDoc.id}: ${e?.message ?? e}`);
      }
    }

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
    // Já vinculado a alguma payable?
    const current = await this.prisma.fiscalDocument.findUnique({
      where: { id: fiscalDoc.id },
      select: { matched_payable_id: true },
    });
    if (current?.matched_payable_id) return; // já tem vínculo

    const amount = fiscalDoc.service_amount > 0n ? fiscalDoc.service_amount : fiscalDoc.total_amount;
    const dateFrom = new Date(fiscalDoc.issue_date); dateFrom.setUTCDate(dateFrom.getUTCDate() - 5);
    const dateTo = new Date(fiscalDoc.issue_date); dateTo.setUTCDate(dateTo.getUTCDate() + 5);

    const orConds: any[] = [];
    if (fiscalDoc.document_number) orConds.push({ document_number: fiscalDoc.document_number });
    orConds.push({ amount, issue_date: { gte: dateFrom, lte: dateTo } });

    const candidate = await this.prisma.accountPayable.findFirst({
      where: {
        company_id: companyId,
        metadeleted: false,
        duplicate_of_id: null,
        supplier_doc: fiscalDoc.issuer_cnpj,
        OR: orConds,
      },
    });

    if (candidate) {
      await this.prisma.fiscalDocument.update({
        where: { id: fiscalDoc.id },
        data: { matched_payable_id: candidate.id, matched_at: new Date(), match_score: 90 },
      });
      return;
    }

    // Cria nova Conta a Pagar
    const due = new Date(fiscalDoc.issue_date);
    due.setUTCDate(due.getUTCDate() + 30);

    const description = fiscalDoc.description
      ? `NFSe ${fiscalDoc.document_number ?? ''} · ${fiscalDoc.description.slice(0, 200)}`
      : `NFSe ${fiscalDoc.document_number ?? ''} · ${fiscalDoc.issuer_name}`;

    const payable = await this.prisma.accountPayable.create({
      data: {
        description: description.trim(),
        supplier_name: fiscalDoc.issuer_name,
        supplier_doc: fiscalDoc.issuer_cnpj,
        document_number: fiscalDoc.document_number,
        amount,
        issue_date: fiscalDoc.issue_date,
        due_date: due,
        status: PaymentStatus.PENDING,
        company_id: companyId,
        source: PayableSource.FISCAL_IMPORT,
      },
    });
    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDoc.id },
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

  async listDocuments(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    where.metadeleted = false;

    if (filters.document_type) where.document_type = filters.document_type;
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.issuer_cnpj) where.issuer_cnpj = filters.issuer_cnpj.replace(/\D/g, '');
    if (filters.matched === 'true') where.OR = [{ matched_payable_id: { not: null } }, { matched_receivable_id: { not: null } }];
    if (filters.matched === 'false') where.AND = [{ matched_payable_id: null }, { matched_receivable_id: null }];

    if (filters.start_date || filters.end_date) {
      where.issue_date = {};
      if (filters.start_date) where.issue_date.gte = new Date(filters.start_date);
      if (filters.end_date) where.issue_date.lte = new Date(filters.end_date);
    }

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.fiscalDocument.findMany({
        where,
        orderBy: { issue_date: 'desc' },
        include: {
          matched_payable: { select: { id: true, description: true, amount: true } },
          matched_receivable: { select: { id: true, description: true, amount: true } },
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
      },
    });
    if (!doc || doc.metadeleted) throw new NotFoundException('Documento não encontrado.');
    assertTenantAccess(doc, current);
    return serializeBigInt(doc);
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

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('documents/:id')
  getDocument(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getDocument(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('sync-logs/:companyId')
  syncLogs(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listSyncLogs(companyId, user);
  }
}

@Module({
  controllers: [FiscalController],
  providers: [FiscalService],
  exports: [FiscalService],
})
export class FiscalModule {}
