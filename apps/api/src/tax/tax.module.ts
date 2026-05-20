import {
  Module, Injectable, NotFoundException, BadRequestException, ForbiddenException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsEnum, IsInt, MaxLength, Min, Max } from 'class-validator';
import {
  Profile, TaxRegime, PisCofinsRegime, IrpjApurationPeriod, IrpjApurationStatus,
  LalurAdjustmentType, PaymentStatus, TaxApurationStatus, IssCalculationBase,
  GgrMethodology,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess } from '../financial/tenant.helper';
import { serializeBigInt } from '../financial/money.helper';
import { suggestIssRate } from './iss-rates';
import {
  calculatePisCofinsNaoCumulativo,
  calculateIrpjCsll,
  calculateIrpjCsllPresumido,
  calculateIss,
  getQuarterDateRange,
  getAdditionalThreshold,
} from './tax-calculator-real';
import { pisCofinsDefaultsForRegime } from './regime-defaults';
import { AccountingModule } from '../accounting/accounting.module';
import { JournalPostingService } from '../accounting/journal-posting.service';
import { GgrModule, GgrService } from '../ggr/ggr.module';

// =================== DTOs ===================

class UpsertTaxConfigDto {
  @IsString() company_id: string;
  @IsOptional() @IsEnum(TaxRegime) tax_regime?: TaxRegime;
  @IsOptional() @IsEnum(PisCofinsRegime) pis_cofins_regime?: PisCofinsRegime;
  @IsOptional() @IsEnum(IrpjApurationPeriod) apuration_period?: IrpjApurationPeriod;
  @IsOptional() @IsNumber() pis_rate?: number;
  @IsOptional() @IsNumber() cofins_rate?: number;
  @IsOptional() @IsNumber() irpj_rate?: number;
  @IsOptional() @IsNumber() irpj_additional_rate?: number;
  @IsOptional() @IsNumber() csll_rate?: number;
  @IsOptional() @IsNumber() presumed_irpj_rate?: number;
  @IsOptional() @IsNumber() presumed_csll_rate?: number;
  @IsOptional() @IsNumber() iss_rate?: number;
  @IsOptional() @IsEnum(IssCalculationBase) iss_calculation_base?: IssCalculationBase;
  /** Metodologia de cálculo do GGR para a Lei 14.790. */
  @IsOptional() @IsEnum(GgrMethodology) ggr_methodology?: GgrMethodology;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/** Termo de responsabilidade assinado pelo representante legal. */
class UploadGgrTermDto {
  @IsString() company_id: string;
  /** PDF assinado em base64. */
  @IsString() pdf_base64: string;
  @IsString() @MaxLength(120) signed_by_name: string;
  @IsString() @MaxLength(20)  signed_by_cpf: string;
  /** Confirma a metodologia que o termo cobre (precisa bater com o que vai ser salvo). */
  @IsEnum(GgrMethodology) methodology: GgrMethodology;
}

class CalculateIrpjDto {
  @IsString() company_id: string;
  @IsInt() @Min(2020) @Max(2100) year: number;
  @IsOptional() @IsInt() @Min(1) @Max(4) quarter?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) month?: number;
}

class CloseIrpjDto {
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class LalurAdjustmentDto {
  @IsEnum(LalurAdjustmentType) type: LalurAdjustmentType;
  @IsString() @MaxLength(300) description: string;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() reference_date?: string;
}

class UpdatePayableTaxDto {
  @IsOptional() is_deductible_expense?: boolean;
  @IsOptional() generates_pis_cofins_credit?: boolean;
}

class CalculatePisCofinsDto {
  @IsString() company_id: string;
  @IsInt() @Min(2020) @Max(2100) year: number;
  @IsInt() @Min(1) @Max(12) month: number;
}

class CalculateIssDto {
  @IsString() company_id: string;
  @IsInt() @Min(2020) @Max(2100) year: number;
  @IsInt() @Min(1) @Max(12) month: number;
  @IsOptional() @IsEnum(IssCalculationBase) calculation_base?: IssCalculationBase;
}

// =================== SERVICE ===================

@Injectable()
export class TaxService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private posting: JournalPostingService,
    private ggrService: GgrService,
  ) {}

  private async safePostIrpj(id: string) {
    try { await this.posting.postIrpjCsllClose(id); }
    catch (e: any) { console.warn(`[IRPJ posting] ${id}: ${e?.message ?? e}`); }
  }
  private async safePostPisCofins(id: string) {
    try { await this.posting.postPisCofinsClose(id); }
    catch (e: any) { console.warn(`[PIS/COFINS posting] ${id}: ${e?.message ?? e}`); }
  }
  private async safePostIss(id: string) {
    try { await this.posting.postIssClose(id); }
    catch (e: any) { console.warn(`[ISS posting] ${id}: ${e?.message ?? e}`); }
  }

  /** Obtém ou cria a configuração tributária da empresa (com defaults) */
  async getTaxConfig(companyId: string, current: any) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    let config = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: companyId } });
    if (!config) {
      // Cria com defaults de Lucro Real não-cumulativo (caso mais comum em casas de apostas)
      config = await this.prisma.companyTaxConfig.create({
        data: {
          company_id: companyId,
          tax_regime: TaxRegime.LUCRO_REAL,
          pis_cofins_regime: PisCofinsRegime.NAO_CUMULATIVO,
          apuration_period: IrpjApurationPeriod.TRIMESTRAL,
          pis_rate: 1.65,
          cofins_rate: 7.6,
          irpj_rate: 15.0,
          irpj_additional_rate: 10.0,
          csll_rate: 9.0,
        },
      });
    }
    return serializeBigInt(config);
  }

  async upsertTaxConfig(dto: UpsertTaxConfigDto, current: any) {
    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    const existing = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: dto.company_id } });
    const data: any = { ...dto };
    delete data.company_id;

    // Quando muda o regime tributário, sincroniza PIS/COFINS conforme legislação,
    // a menos que o usuário tenha enviado uma alíquota explícita no mesmo payload.
    if (data.tax_regime && data.tax_regime !== existing?.tax_regime) {
      const defaults = pisCofinsDefaultsForRegime(data.tax_regime);
      if (defaults) {
        if (data.pis_cofins_regime === undefined) data.pis_cofins_regime = defaults.pis_cofins_regime;
        if (data.pis_rate === undefined) data.pis_rate = defaults.pis_rate;
        if (data.cofins_rate === undefined) data.cofins_rate = defaults.cofins_rate;
      }
    }

    // Auto-ajusta alíquotas PIS/COFINS quando muda só o regime PIS/COFINS (sem trocar tax_regime)
    if (data.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO && existing?.pis_cofins_regime !== PisCofinsRegime.NAO_CUMULATIVO) {
      if (data.pis_rate === undefined) data.pis_rate = 1.65;
      if (data.cofins_rate === undefined) data.cofins_rate = 7.6;
    } else if (data.pis_cofins_regime === PisCofinsRegime.CUMULATIVO && existing?.pis_cofins_regime !== PisCofinsRegime.CUMULATIVO) {
      if (data.pis_rate === undefined) data.pis_rate = 0.65;
      if (data.cofins_rate === undefined) data.cofins_rate = 3.0;
    }

    // Trava de segurança: não permite ativar metodologia com abatimento sem
    // termo de responsabilidade assinado. Voltar para OFFICIAL é sempre livre.
    if (data.ggr_methodology && data.ggr_methodology !== GgrMethodology.OFFICIAL) {
      const hasSignedTerm = existing?.ggr_term_signed_at && existing?.ggr_methodology === data.ggr_methodology;
      if (!hasSignedTerm) {
        throw new BadRequestException(
          'Antes de ativar metodologia com abatimento, faça upload do termo de responsabilidade assinado pelo representante legal.',
        );
      }
    }

    const config = existing
      ? await this.prisma.companyTaxConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.companyTaxConfig.create({ data: { ...data, company_id: dto.company_id } });

    // Mantém Company.tax_regime em sintonia com a config.
    if (data.tax_regime && data.tax_regime !== existing?.tax_regime) {
      await this.prisma.company.update({ where: { id: dto.company_id }, data: { tax_regime: data.tax_regime } });
    }

    await this.audit.log(existing ? 'UPDATE' : 'CREATE', 'TAX_CONFIG', config.id, current.id);

    // Quando muda algo que afeta cálculo (alíquotas, metodologia, regime),
    // marca apurações OPEN como pendentes de recálculo limpando o updated_at
    // assim a próxima visualização força re-cálculo. Aqui fazemos o recálculo
    // direto pra garantir que a lista reflita imediatamente as novas regras.
    const affectsCalc = (
      data.ggr_methodology !== undefined ||
      data.pis_rate !== undefined ||
      data.cofins_rate !== undefined ||
      data.pis_cofins_regime !== undefined ||
      data.iss_rate !== undefined ||
      data.iss_calculation_base !== undefined ||
      data.tax_regime !== undefined
    );
    if (affectsCalc) {
      const recalcSummary = await this.recalculateOpenGgrApurations(dto.company_id, current);
      return serializeBigInt({ ...config, _recalc: recalcSummary });
    }

    return serializeBigInt(config);
  }

  /**
   * Re-calcula todas as apurações GGR OPEN da empresa após mudança de config.
   * Reusa GgrService.getMonthlyApuration que já aplica a config nova ao
   * recalcular qualquer apuração com status OPEN.
   */
  private async recalculateOpenGgrApurations(companyId: string, current: any) {
    const open = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id: companyId, metadeleted: false, status: 'OPEN' },
      select: { brand_id: true, year: true, month: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      distinct: ['brand_id', 'year', 'month'],
    });
    if (open.length === 0) return { total: 0, ok: 0, failed: 0 };

    let ok = 0;
    let failed = 0;
    const errors: Array<{ brand_id: string; year: number; month: number; error: string }> = [];
    for (const a of open) {
      try {
        await this.ggrService.getMonthlyApuration(a.brand_id, a.year, a.month, current);
        ok++;
      } catch (e: any) {
        failed++;
        errors.push({ brand_id: a.brand_id, year: a.year, month: a.month, error: e?.message ?? 'erro' });
      }
    }
    return { total: open.length, ok, failed, errors };
  }

  /**
   * Gera o PDF do termo de responsabilidade pré-preenchido com os dados da
   * empresa. O cliente baixa, imprime, o representante legal assina e
   * devolve via upload.
   */
  async generateGgrTermPdf(
    companyId: string,
    methodology: GgrMethodology,
    current: any,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException('Empresa inválida.');
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    if (methodology === GgrMethodology.OFFICIAL) {
      throw new BadRequestException('Metodologia oficial não exige termo.');
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    const formula = methodology === GgrMethodology.DEDUCT_CASHBACK
      ? 'GGR = Apostas Brutas − Prêmios Pagos − Cashback Distribuído'
      : 'GGR = Apostas Brutas − Prêmios Pagos − Bônus Distribuído − Cashback';
    const methodLabel = methodology === GgrMethodology.DEDUCT_CASHBACK
      ? 'abatimento de Cashback'
      : 'abatimento de Bônus e Cashback';

    doc.fontSize(14).font('Helvetica-Bold').text('TERMO DE RESPONSABILIDADE', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).text('METODOLOGIA DE APURAÇÃO DE GGR — LEI 14.790/2023', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(10).font('Helvetica');
    const cnpjFmt = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';

    const intro = `Pelo presente termo, ${company.name?.toUpperCase()}, inscrita no CNPJ sob o nº ${cnpjFmt(company.cnpj || '')}, com sede em ${[company.city, company.state].filter(Boolean).join('/') || '________________'} (doravante "OPERADORA"), neste ato representada por __________________________________, CPF __________________, na qualidade de operadora autorizada de apostas de quota fixa nos termos da Lei 14.790/2023, vem firmar o presente TERMO:`;
    doc.text(intro, { align: 'justify' });
    doc.moveDown();

    doc.font('Helvetica-Bold').text('1. DAS DECLARAÇÕES');
    doc.font('Helvetica').moveDown(0.3);
    doc.text('1.1. A OPERADORA DECLARA estar ciente de que a Secretaria de Prêmios e Apostas do Ministério da Fazenda (SPA/MF) e a Receita Federal interpretam o GGR como "arrecadação de apostas líquida dos prêmios pagos", conforme art. 30 da Lei 14.790/2023.', { align: 'justify' });
    doc.moveDown(0.5);
    doc.text(`1.2. A OPERADORA, com base em interpretação jurídica própria, OPTA por adotar metodologia de cálculo do GGR com ${methodLabel}, segundo a fórmula:`, { align: 'justify' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(formula, { align: 'center' });
    doc.font('Helvetica').moveDown();

    doc.font('Helvetica-Bold').text('2. DO RECONHECIMENTO DE RISCO');
    doc.font('Helvetica').moveDown(0.3);
    doc.text('2.1. A OPERADORA RECONHECE que esta interpretação:');
    doc.text('     a) NÃO é pacificada pela SPA/MF nem pela Receita Federal;', { align: 'justify' });
    doc.text('     b) Pode ser objeto de fiscalização e autuação federal;', { align: 'justify' });
    doc.text('     c) Pode resultar em multas, juros, glosas e ações judiciais cuja responsabilidade é EXCLUSIVA da OPERADORA.', { align: 'justify' });
    doc.moveDown();

    doc.font('Helvetica-Bold').text('3. DA ISENÇÃO DE RESPONSABILIDADE');
    doc.font('Helvetica').moveDown(0.3);
    doc.text('3.1. A OPERADORA ISENTA o escritório contábil contratado e a plataforma ContBet de TODA E QUALQUER responsabilidade quanto à interpretação fiscal aqui adotada, declarando que tal escolha foi tomada de forma livre, consciente e baseada em orientação jurídica própria da OPERADORA.', { align: 'justify' });
    doc.moveDown();

    doc.font('Helvetica-Bold').text('4. DA AUTORIZAÇÃO');
    doc.font('Helvetica').moveDown(0.3);
    doc.text('4.1. A OPERADORA AUTORIZA a plataforma ContBet a calcular as apurações mensais de GGR utilizando a fórmula declarada na cláusula 1.2.', { align: 'justify' });
    doc.text('4.2. A OPERADORA compromete-se a manter este termo arquivado e disponibilizá-lo à fiscalização quando solicitado.', { align: 'justify' });
    doc.moveDown(2);

    const today = new Date().toLocaleDateString('pt-BR');
    doc.text(`${[company.city, company.state].filter(Boolean).join('/') || '__________________'}, ${today}.`, { align: 'right' });
    doc.moveDown(3);

    doc.text('___________________________________________________', { align: 'center' });
    doc.font('Helvetica-Bold').text('REPRESENTANTE LEGAL', { align: 'center' });
    doc.font('Helvetica').text('Nome: __________________________________________', { align: 'center' });
    doc.text('CPF: ___________________________________________', { align: 'center' });
    doc.text(`${company.name?.toUpperCase()} — CNPJ ${cnpjFmt(company.cnpj || '')}`, { align: 'center' });

    doc.end();
    await done;
    const buffer = Buffer.concat(chunks);
    const stamp = new Date().toISOString().split('T')[0];
    const safeName = (company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    const methodSlug = methodology === GgrMethodology.DEDUCT_CASHBACK ? 'cashback' : 'bonus-e-cashback';
    return { buffer, filename: `termo-ggr-${methodSlug}-${safeName}-${stamp}.pdf` };
  }

  /** Recebe PDF assinado, valida e ativa o termo (ainda não muda metodologia em si). */
  async uploadGgrTerm(dto: UploadGgrTermDto, current: any) {
    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    if (dto.methodology === GgrMethodology.OFFICIAL) {
      throw new BadRequestException('Metodologia oficial não exige termo.');
    }

    const cleanCpf = (dto.signed_by_cpf ?? '').replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      throw new BadRequestException('CPF do signatário inválido.');
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(dto.pdf_base64, 'base64');
    } catch {
      throw new BadRequestException('PDF inválido (base64 corrompido).');
    }
    if (pdfBuffer.length < 100 || !pdfBuffer.subarray(0, 5).toString('utf8').startsWith('%PDF')) {
      throw new BadRequestException('Arquivo enviado não é um PDF válido.');
    }
    if (pdfBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('PDF muito grande (máx 10MB).');
    }

    const existing = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: dto.company_id } });
    const data: any = {
      ggr_methodology: dto.methodology,
      ggr_term_pdf_data: pdfBuffer,
      ggr_term_signed_at: new Date(),
      ggr_term_signed_by_name: dto.signed_by_name,
      ggr_term_signed_by_cpf: cleanCpf,
      ggr_term_uploaded_by_id: current.id,
    };
    const config = existing
      ? await this.prisma.companyTaxConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.companyTaxConfig.create({ data: { ...data, company_id: dto.company_id } });

    await this.audit.log('UPLOAD_GGR_TERM', 'TAX_CONFIG', config.id, current.id, {
      methodology: dto.methodology,
      signed_by: dto.signed_by_name,
      cpf: cleanCpf,
    });

    // Não devolve o binário — só os metadados.
    const { ggr_term_pdf_data, ...safe } = config as any;
    return serializeBigInt({ ...safe, ggr_term_has_pdf: true });
  }

  /** Download do PDF assinado armazenado. */
  async getGgrTermPdf(companyId: string, current: any): Promise<Buffer | null> {
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const cfg = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: companyId } });
    return cfg?.ggr_term_pdf_data ? Buffer.from(cfg.ggr_term_pdf_data) : null;
  }

  /**
   * Calcula a apuração trimestral de IRPJ/CSLL para uma empresa.
   * Cruza dados de:
   * - Receitas: GGR consolidado dos 3 meses do trimestre
   * - Receitas: Contas a Receber recebidas no período
   * - Despesas: Contas a Pagar PAGAS no período (com is_deductible_expense=true)
   * - Ajustes: LalurAdjustment do período
   */
  async calculateIrpjCsll(dto: CalculateIrpjDto, current: any) {
    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    const config = await this.getTaxConfigInternal(dto.company_id);

    // Determina período
    let start: Date, end: Date;
    let periodType: IrpjApurationPeriod;
    if (dto.quarter) {
      periodType = IrpjApurationPeriod.TRIMESTRAL;
      const range = getQuarterDateRange(dto.year, dto.quarter);
      start = range.start;
      end = range.end;
    } else if (dto.month) {
      periodType = IrpjApurationPeriod.ANUAL_ESTIMATIVA;
      start = new Date(Date.UTC(dto.year, dto.month - 1, 1));
      end = new Date(Date.UTC(dto.year, dto.month, 1));
    } else {
      throw new BadRequestException('Forneça quarter (1-4) para trimestral OU month (1-12) para mensal.');
    }

    // === RECEITAS: GGR consolidado do período ===
    const ggrRecords = await this.prisma.ggrDailyRecord.findMany({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        date: { gte: start, lt: end },
      },
    });
    const ggr_revenue = ggrRecords.reduce((s, r) => s + r.ggr, 0n);

    // === RECEITAS: Outras receitas (Contas a Receber recebidas no período) ===
    const receivables = await this.prisma.accountReceivable.findMany({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        status: PaymentStatus.PAID,
        receipt_date: { gte: start, lt: end },
      },
    });
    const other_revenue = receivables.reduce((s, r) => s + r.received_amount, 0n);

    const total_revenue = ggr_revenue + other_revenue;

    // === DESPESAS DEDUTÍVEIS: Contas a Pagar pagas no período ===
    const payables = await this.prisma.accountPayable.findMany({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        status: PaymentStatus.PAID,
        is_deductible_expense: true,
        payment_date: { gte: start, lt: end },
      },
    });
    const deductible_expenses = payables.reduce((s, p) => s + p.paid_amount, 0n);

    // === BUSCA OU CRIA APURAÇÃO ===
    // Como UNIQUE é (company_id, period_type, year, quarter, month) e quarter pode ser null,
    // usamos findFirst em vez de findUnique
    let apuration = await this.prisma.irpjCsllApuration.findFirst({
      where: {
        company_id: dto.company_id,
        period_type: periodType,
        year: dto.year,
        quarter: dto.quarter ?? null,
        month: dto.month ?? null,
        metadeleted: false,
      },
      include: { lalur_adjustments: { where: { metadeleted: false } } },
    });

    // === AJUSTES LALUR ===
    const adjustments = apuration?.lalur_adjustments || [];
    const total_additions = adjustments
      .filter(a => a.type === LalurAdjustmentType.ADDITION)
      .reduce((s, a) => s + a.amount, 0n);
    const total_exclusions = adjustments
      .filter(a => a.type === LalurAdjustmentType.EXCLUSION)
      .reduce((s, a) => s + a.amount, 0n);

    // === CÁLCULO ===
    const additionalThreshold = getAdditionalThreshold(periodType);

    if (config.tax_regime === TaxRegime.SIMPLES_NACIONAL) {
      throw new BadRequestException('Empresas no Simples Nacional pagam IRPJ/CSLL via DAS — apuração separada não se aplica.');
    }

    let apurationData: any;
    if (config.tax_regime === TaxRegime.LUCRO_PRESUMIDO) {
      // Lucro Presumido — não considera despesa nem ajustes LALUR.
      if (adjustments.length > 0) {
        // Ignora — ajustes LALUR não se aplicam aqui. Mantém em DB para histórico.
      }
      const result = calculateIrpjCsllPresumido({
        total_revenue,
        presumed_irpj_rate: Number(config.presumed_irpj_rate),
        presumed_csll_rate: Number(config.presumed_csll_rate),
        irpj_rate: Number(config.irpj_rate),
        irpj_additional_rate: Number(config.irpj_additional_rate),
        irpj_additional_threshold_cents: additionalThreshold,
        csll_rate: Number(config.csll_rate),
      });
      apurationData = {
        period_type: periodType,
        year: dto.year,
        quarter: dto.quarter ?? null,
        month: dto.month ?? null,
        ggr_revenue,
        other_revenue,
        total_revenue,
        deductible_expenses: 0n, // não se aplica
        accounting_profit: result.presumed_irpj_base, // exibe a base presumida no lugar
        total_additions: 0n,
        total_exclusions: 0n,
        taxable_profit: result.presumed_irpj_base,
        irpj_base_amount: result.irpj_base_amount,
        irpj_additional_amount: result.irpj_additional_amount,
        irpj_total: result.irpj_total,
        irpj_rate: Number(config.irpj_rate),
        irpj_additional_rate: Number(config.irpj_additional_rate),
        irpj_additional_threshold: additionalThreshold,
        csll_amount: result.csll_amount,
        csll_rate: Number(config.csll_rate),
        total_taxes: result.total_taxes,
        company_id: dto.company_id,
      };
    } else {
      // Lucro Real (default)
      const result = calculateIrpjCsll({
        total_revenue,
        deductible_expenses,
        total_additions,
        total_exclusions,
        irpj_rate: Number(config.irpj_rate),
        irpj_additional_rate: Number(config.irpj_additional_rate),
        irpj_additional_threshold_cents: additionalThreshold,
        csll_rate: Number(config.csll_rate),
      });
      apurationData = {
        period_type: periodType,
        year: dto.year,
        quarter: dto.quarter ?? null,
        month: dto.month ?? null,
        ggr_revenue,
        other_revenue,
        total_revenue,
        deductible_expenses,
        accounting_profit: result.accounting_profit,
        total_additions,
        total_exclusions,
        taxable_profit: result.taxable_profit,
        irpj_base_amount: result.irpj_base_amount,
        irpj_additional_amount: result.irpj_additional_amount,
        irpj_total: result.irpj_total,
        irpj_rate: Number(config.irpj_rate),
        irpj_additional_rate: Number(config.irpj_additional_rate),
        irpj_additional_threshold: additionalThreshold,
        csll_amount: result.csll_amount,
        csll_rate: Number(config.csll_rate),
        total_taxes: result.total_taxes,
        company_id: dto.company_id,
      };
    }

    if (apuration) {
      // Não recalcula se já estiver fechada
      if (apuration.status !== IrpjApurationStatus.OPEN) {
        return serializeBigInt({
          apuration,
          adjustments,
          breakdown: {
            ggr_revenue: ggr_revenue.toString(),
            other_revenue: other_revenue.toString(),
            payables_count: payables.length,
            ggr_records_count: ggrRecords.length,
          },
        });
      }
      apuration = await this.prisma.irpjCsllApuration.update({
        where: { id: apuration.id },
        data: apurationData,
        include: { lalur_adjustments: { where: { metadeleted: false } } },
      });
    } else {
      apuration = await this.prisma.irpjCsllApuration.create({
        data: apurationData,
        include: { lalur_adjustments: { where: { metadeleted: false } } },
      });
    }

    return serializeBigInt({
      apuration,
      adjustments: apuration.lalur_adjustments,
      breakdown: {
        ggr_revenue: ggr_revenue.toString(),
        other_revenue: other_revenue.toString(),
        payables_count: payables.length,
        ggr_records_count: ggrRecords.length,
      },
    });
  }

  private async getTaxConfigInternal(companyId: string) {
    let config = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: companyId } });
    if (!config) {
      config = await this.prisma.companyTaxConfig.create({
        data: {
          company_id: companyId,
          tax_regime: TaxRegime.LUCRO_REAL,
          pis_cofins_regime: PisCofinsRegime.NAO_CUMULATIVO,
          apuration_period: IrpjApurationPeriod.TRIMESTRAL,
          pis_rate: 1.65,
          cofins_rate: 7.6,
        },
      });
    }
    return config;
  }

  async listIrpjApurations(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    where.metadeleted = false;
    if (filters.year) where.year = parseInt(filters.year);
    if (filters.status) where.status = filters.status;

    const data = await this.prisma.irpjCsllApuration.findMany({
      where,
      orderBy: [{ year: 'desc' }, { quarter: 'desc' }, { month: 'desc' }],
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { lalur_adjustments: { where: { metadeleted: false } } } },
      },
      take: 100,
    });
    return serializeBigInt({ data, total: data.length });
  }

  async getIrpjApuration(id: string, current: any) {
    const a = await this.prisma.irpjCsllApuration.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        lalur_adjustments: { where: { metadeleted: false }, orderBy: { created_at: 'desc' } },
        generated_payables: true,
      },
    });
    if (!a || a.metadeleted) throw new NotFoundException('Apuração não encontrada.');
    assertTenantAccess(a, current);
    return serializeBigInt(a);
  }

  async addLalurAdjustment(apurationId: string, dto: LalurAdjustmentDto, current: any) {
    const apuration = await this.prisma.irpjCsllApuration.findUnique({ where: { id: apurationId } });
    if (!apuration || apuration.metadeleted) throw new NotFoundException('Apuração não encontrada.');
    assertTenantAccess(apuration, current);
    if (apuration.status !== IrpjApurationStatus.OPEN) {
      throw new BadRequestException('Apuração já fechada não aceita novos ajustes.');
    }
    const cfg = await this.getTaxConfigInternal(apuration.company_id);
    if (cfg.tax_regime !== TaxRegime.LUCRO_REAL) {
      throw new BadRequestException('Ajustes LALUR só se aplicam ao regime Lucro Real.');
    }

    const data: any = {
      type: dto.type,
      description: dto.description,
      amount: BigInt(dto.amount),
      notes: dto.notes,
      company_id: apuration.company_id,
      apuration_id: apurationId,
    };
    if (dto.reference_date) data.reference_date = new Date(dto.reference_date);

    const adj = await this.prisma.lalurAdjustment.create({ data });
    await this.audit.log('CREATE', 'LALUR_ADJUSTMENT', adj.id, current.id);

    // Recalcula a apuração
    await this.recalcApuration(apurationId);

    return serializeBigInt(adj);
  }

  async deleteLalurAdjustment(id: string, current: any) {
    const adj = await this.prisma.lalurAdjustment.findUnique({ where: { id } });
    if (!adj || adj.metadeleted) throw new NotFoundException('Ajuste não encontrado.');
    assertTenantAccess(adj, current);

    const apuration = await this.prisma.irpjCsllApuration.findUnique({ where: { id: adj.apuration_id } });
    if (apuration?.status !== IrpjApurationStatus.OPEN) {
      throw new BadRequestException('Apuração já fechada não permite remoção de ajustes.');
    }

    await this.prisma.lalurAdjustment.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'LALUR_ADJUSTMENT', id, current.id);
    await this.recalcApuration(adj.apuration_id);
    return { ok: true };
  }

  /** Recalcula a apuração após mudança em ajustes LALUR */
  private async recalcApuration(apurationId: string) {
    const a = await this.prisma.irpjCsllApuration.findUnique({
      where: { id: apurationId },
      include: { lalur_adjustments: { where: { metadeleted: false } } },
    });
    if (!a) return;

    const total_additions = a.lalur_adjustments
      .filter(adj => adj.type === LalurAdjustmentType.ADDITION)
      .reduce((s, adj) => s + adj.amount, 0n);
    const total_exclusions = a.lalur_adjustments
      .filter(adj => adj.type === LalurAdjustmentType.EXCLUSION)
      .reduce((s, adj) => s + adj.amount, 0n);

    const result = calculateIrpjCsll({
      total_revenue: a.total_revenue,
      deductible_expenses: a.deductible_expenses,
      total_additions,
      total_exclusions,
      irpj_rate: Number(a.irpj_rate),
      irpj_additional_rate: Number(a.irpj_additional_rate),
      irpj_additional_threshold_cents: a.irpj_additional_threshold,
      csll_rate: Number(a.csll_rate),
    });

    await this.prisma.irpjCsllApuration.update({
      where: { id: apurationId },
      data: {
        total_additions,
        total_exclusions,
        accounting_profit: result.accounting_profit,
        taxable_profit: result.taxable_profit,
        irpj_base_amount: result.irpj_base_amount,
        irpj_additional_amount: result.irpj_additional_amount,
        irpj_total: result.irpj_total,
        csll_amount: result.csll_amount,
        total_taxes: result.total_taxes,
      },
    });
  }

  /** Fecha a apuração e gera as contas a pagar do IRPJ + CSLL */
  async closeIrpjApuration(id: string, dto: CloseIrpjDto, current: any) {
    const apuration = await this.prisma.irpjCsllApuration.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!apuration || apuration.metadeleted) throw new NotFoundException('Apuração não encontrada.');
    assertTenantAccess(apuration, current);
    if (apuration.status !== IrpjApurationStatus.OPEN) {
      throw new BadRequestException('Apuração já está fechada.');
    }

    // Vencimento padrão: último dia útil do mês seguinte ao período
    let dueMonth: number, dueYear: number;
    if (apuration.period_type === IrpjApurationPeriod.TRIMESTRAL && apuration.quarter) {
      const lastQuarterMonth = apuration.quarter * 3; // Q1=3, Q2=6, Q3=9, Q4=12
      dueMonth = lastQuarterMonth; // mesmo mês final
      dueYear = apuration.year;
      if (dueMonth >= 12) {
        dueMonth = 0;
        dueYear++;
      } else {
        dueMonth++;
      }
    } else {
      dueMonth = (apuration.month ?? 1);
      dueYear = apuration.year;
      if (dueMonth >= 12) {
        dueMonth = 0;
        dueYear++;
      }
    }
    const dueDate = new Date(Date.UTC(dueYear, dueMonth, 30)); // dia 30

    const periodLabel = apuration.period_type === IrpjApurationPeriod.TRIMESTRAL
      ? `${apuration.quarter}T/${apuration.year}`
      : `${String(apuration.month).padStart(2, '0')}/${apuration.year}`;

    const generated: any[] = [];

    if (apuration.irpj_total > 0n) {
      const p = await this.prisma.accountPayable.create({
        data: {
          description: `IRPJ - Lucro Real ${periodLabel}`,
          supplier_name: 'Receita Federal',
          amount: apuration.irpj_total,
          issue_date: new Date(),
          due_date: dueDate,
          company_id: apuration.company_id,
          irpj_apuration_id: apuration.id,
          notes: `IRPJ ${apuration.irpj_rate}% sobre lucro real + adicional ${apuration.irpj_additional_rate}% sobre faixa`,
          is_deductible_expense: false,
        },
      });
      generated.push(p);
    }

    if (apuration.csll_amount > 0n) {
      const p = await this.prisma.accountPayable.create({
        data: {
          description: `CSLL - Lucro Real ${periodLabel}`,
          supplier_name: 'Receita Federal',
          amount: apuration.csll_amount,
          issue_date: new Date(),
          due_date: dueDate,
          company_id: apuration.company_id,
          irpj_apuration_id: apuration.id,
          notes: `CSLL ${apuration.csll_rate}% sobre lucro real`,
          is_deductible_expense: false,
        },
      });
      generated.push(p);
    }

    const closed = await this.prisma.irpjCsllApuration.update({
      where: { id: apuration.id },
      data: {
        status: IrpjApurationStatus.CLOSED,
        closed_at: new Date(),
        closed_by_id: current.id,
        notes: dto.notes,
      },
    });

    await this.audit.log('CLOSE', 'IRPJ_APURATION', apuration.id, current.id, {
      generated_payables: generated.length,
    });
    await this.safePostIrpj(apuration.id);

    return serializeBigInt({ apuration: closed, generated_payables: generated });
  }

  async reopenIrpjApuration(id: string, current: any) {
    const apuration = await this.prisma.irpjCsllApuration.findUnique({ where: { id } });
    if (!apuration) throw new NotFoundException('Apuração não encontrada.');
    assertTenantAccess(apuration, current);
    if (apuration.status === IrpjApurationStatus.PAID) {
      throw new BadRequestException('Apuração já paga não pode ser reaberta.');
    }

    await this.prisma.accountPayable.updateMany({
      where: { irpj_apuration_id: id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELLED },
    });

    const reopened = await this.prisma.irpjCsllApuration.update({
      where: { id },
      data: { status: IrpjApurationStatus.OPEN, closed_at: null, closed_by_id: null },
    });

    await this.audit.log('REOPEN', 'IRPJ_APURATION', id, current.id);
    return serializeBigInt(reopened);
  }

  // ===== Marcação de Conta a Pagar como dedutível / gera crédito =====
  async updatePayableTaxFlags(payableId: string, dto: UpdatePayableTaxDto, current: any) {
    const p = await this.prisma.accountPayable.findUnique({ where: { id: payableId } });
    if (!p || p.metadeleted) throw new NotFoundException('Conta a pagar não encontrada.');
    assertTenantAccess(p, current);

    const config = await this.getTaxConfigInternal(p.company_id);

    const data: any = {};
    if (dto.is_deductible_expense !== undefined) data.is_deductible_expense = dto.is_deductible_expense;
    if (dto.generates_pis_cofins_credit !== undefined) {
      data.generates_pis_cofins_credit = dto.generates_pis_cofins_credit;
      // Calcula o crédito automaticamente
      if (dto.generates_pis_cofins_credit) {
        const factorPis = BigInt(Math.round(Number(config.pis_rate) * 10000));
        const factorCofins = BigInt(Math.round(Number(config.cofins_rate) * 10000));
        data.pis_credit_amount = (p.amount * factorPis) / BigInt(1_000_000);
        data.cofins_credit_amount = (p.amount * factorCofins) / BigInt(1_000_000);
      } else {
        data.pis_credit_amount = 0n;
        data.cofins_credit_amount = 0n;
      }
    }

    const updated = await this.prisma.accountPayable.update({ where: { id: payableId }, data });
    await this.audit.log('UPDATE_TAX_FLAGS', 'ACCOUNT_PAYABLE', payableId, current.id);
    return serializeBigInt(updated);
  }

  // ===== Recalcula PIS/COFINS de uma apuração de GGR usando o regime correto =====
  async recalculatePisCofinsForGgr(apurationId: string, current: any) {
    const apuration = await this.prisma.ggrMonthlyApuration.findUnique({
      where: { id: apurationId },
      include: { brand: true },
    });
    if (!apuration) throw new NotFoundException('Apuração GGR não encontrada.');
    assertTenantAccess(apuration, current);

    const config = await this.getTaxConfigInternal(apuration.company_id);

    // Receita = GGR (não-negativo)
    const revenue = apuration.ggr > 0n ? apuration.ggr : 0n;

    // Despesas com crédito PIS/COFINS: Contas a Pagar pagas no mês com flag generates_pis_cofins_credit
    const monthStart = new Date(Date.UTC(apuration.year, apuration.month - 1, 1));
    const monthEnd = new Date(Date.UTC(apuration.year, apuration.month, 1));

    const payables = await this.prisma.accountPayable.findMany({
      where: {
        company_id: apuration.company_id,
        metadeleted: false,
        status: PaymentStatus.PAID,
        generates_pis_cofins_credit: true,
        payment_date: { gte: monthStart, lt: monthEnd },
      },
    });
    const expenses_with_credit = payables.reduce((s, p) => s + p.paid_amount, 0n);

    const result = calculatePisCofinsNaoCumulativo({
      total_revenue: revenue,
      expenses_with_credit,
      pis_rate: Number(config.pis_rate),
      cofins_rate: Number(config.cofins_rate),
    });

    const updated = await this.prisma.ggrMonthlyApuration.update({
      where: { id: apurationId },
      data: {
        pis_cofins_regime: config.pis_cofins_regime,
        pis_rate: Number(config.pis_rate),
        cofins_rate: Number(config.cofins_rate),
        pis_amount: result.pis_amount,
        pis_credits: result.pis_credits,
        pis_amount_payable: result.pis_amount_payable,
        cofins_amount: result.cofins_amount,
        cofins_credits: result.cofins_credits,
        cofins_amount_payable: result.cofins_amount_payable,
        total_taxes: apuration.tax_lei14790_amount + apuration.irrf_amount + result.pis_amount_payable + result.cofins_amount_payable,
      },
    });

    return serializeBigInt({
      apuration: updated,
      payables_with_credit_count: payables.length,
      expenses_with_credit: expenses_with_credit.toString(),
    });
  }

  // =================== PIS/COFINS (mensal, standalone) ===================

  async calculatePisCofins(dto: CalculatePisCofinsDto, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const config = await this.getTaxConfigInternal(dto.company_id);

    const start = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const end = new Date(Date.UTC(dto.year, dto.month, 1));

    // GGR usado em PIS/COFINS = soma das apurações MENSAIS (já com metodologia
    // aplicada como DEDUCT_CASHBACK). Mantém consistência com ISS e DRE.
    const monthlyApurations = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id: dto.company_id, year: dto.year, month: dto.month, metadeleted: false },
    });
    const ggr_revenue = monthlyApurations.reduce((s, a) => s + (a.ggr > 0n ? a.ggr : 0n), 0n);

    // PIS/COFINS incidem só sobre receita operacional. Não-operacional fica fora da base.
    const receivables = await this.prisma.accountReceivable.findMany({
      where: {
        company_id: dto.company_id, metadeleted: false,
        status: PaymentStatus.PAID, receipt_date: { gte: start, lt: end },
        revenue_type: 'OPERATIONAL',
      },
    });
    const other_revenue = receivables.reduce((s, r) => s + r.received_amount, 0n);

    const total_revenue = ggr_revenue + other_revenue;

    let expenses_with_credit = 0n;
    if (config.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO) {
      const payables = await this.prisma.accountPayable.findMany({
        where: {
          company_id: dto.company_id, metadeleted: false,
          status: PaymentStatus.PAID, generates_pis_cofins_credit: true,
          payment_date: { gte: start, lt: end },
        },
      });
      expenses_with_credit = payables.reduce((s, p) => s + p.paid_amount, 0n);
    }

    const result = calculatePisCofinsNaoCumulativo({
      total_revenue,
      expenses_with_credit,
      pis_rate: Number(config.pis_rate),
      cofins_rate: Number(config.cofins_rate),
    });

    const data = {
      year: dto.year, month: dto.month,
      pis_cofins_regime: config.pis_cofins_regime,
      ggr_revenue, other_revenue, total_revenue, expenses_with_credit,
      pis_rate: Number(config.pis_rate),
      pis_amount: result.pis_amount,
      pis_credits: result.pis_credits,
      pis_amount_payable: result.pis_amount_payable,
      cofins_rate: Number(config.cofins_rate),
      cofins_amount: result.cofins_amount,
      cofins_credits: result.cofins_credits,
      cofins_amount_payable: result.cofins_amount_payable,
      total_taxes: result.total_payable,
      company_id: dto.company_id,
    };

    let apuration = await this.prisma.pisCofinsApuration.findFirst({
      where: { company_id: dto.company_id, year: dto.year, month: dto.month, metadeleted: false },
    });

    if (apuration) {
      if (apuration.status !== TaxApurationStatus.OPEN) {
        return serializeBigInt({ apuration });
      }
      apuration = await this.prisma.pisCofinsApuration.update({ where: { id: apuration.id }, data });
    } else {
      apuration = await this.prisma.pisCofinsApuration.create({ data });
    }

    await this.audit.log('CALCULATE', 'PIS_COFINS_APURATION', apuration.id, current.id);
    return serializeBigInt({ apuration });
  }

  // =================== ISS (mensal, base GGR ou NGR) ===================

  async calculateIss(dto: CalculateIssDto, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const config = await this.getTaxConfigInternal(dto.company_id);
    const calculation_base = dto.calculation_base ?? config.iss_calculation_base;

    const start = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const end = new Date(Date.UTC(dto.year, dto.month, 1));

    // GGR usado para ISS = soma das apurações MENSAIS (já com metodologia aplicada,
    // como DEDUCT_CASHBACK). NÃO usa daily records direto, pois esses guardam
    // GGR bruto (apostas − prêmios) sem ajuste.
    const ggrApurations = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id: dto.company_id, year: dto.year, month: dto.month, metadeleted: false },
    });
    const ggr_amount = ggrApurations.reduce((s, a) => s + (a.ggr > 0n ? a.ggr : 0n), 0n);
    const bet_tax_amount = ggrApurations.reduce((s, a) => s + a.tax_lei14790_amount, 0n);

    // NGR = GGR ajustado − tributo Lei 14.790. Para a Lei Complementar 116/2003,
    // alguns municípios autorizam uso da NGR como base do ISS (caso Pixbet/Serra Branca PB).
    const base_amount = calculation_base === IssCalculationBase.NGR
      ? (ggr_amount > bet_tax_amount ? ggr_amount - bet_tax_amount : 0n)
      : ggr_amount;

    const result = calculateIss({ base_amount, iss_rate: Number(config.iss_rate) });

    const data = {
      year: dto.year, month: dto.month,
      calculation_base,
      ggr_amount, bet_tax_amount, base_amount,
      iss_rate: Number(config.iss_rate),
      iss_amount: result.iss_amount,
      total_taxes: result.iss_amount,
      company_id: dto.company_id,
    };

    let apuration = await this.prisma.issApuration.findFirst({
      where: { company_id: dto.company_id, year: dto.year, month: dto.month, metadeleted: false },
    });

    if (apuration) {
      if (apuration.status !== TaxApurationStatus.OPEN) {
        return serializeBigInt({ apuration });
      }
      apuration = await this.prisma.issApuration.update({ where: { id: apuration.id }, data });
    } else {
      apuration = await this.prisma.issApuration.create({ data });
    }

    await this.audit.log('CALCULATE', 'ISS_APURATION', apuration.id, current.id);
    return serializeBigInt({ apuration });
  }

  // =================== Relatório ISS Consolidado ===================

  /**
   * Relatório consolidado de ISS para um mês/empresa.
   * - Garante que existe IssApuration calculada para o período (recalcula se OPEN)
   * - Detalha o ISS por marca (rateio proporcional ao GGR de cada marca)
   * - Inclui base de cálculo (GGR ou NGR), alíquota municipal e total
   * - Mesmo formato do relatório de GGR para consistência visual
   */
  async getIssReport(companyId: string, year: number, month: number, current: any, brandId?: string) {
    if (!companyId) throw new BadRequestException('Empresa obrigatória.');
    if (month < 1 || month > 12) throw new BadRequestException('Mês inválido.');

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, cnpj: true, city: true, state: true, tax_regime: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new ForbiddenException('Sem acesso a esta empresa.');
    }

    const taxConfig = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: companyId } });

    // 1) Garante que ISS está calculado (recalcula se OPEN)
    let issApuration = await this.prisma.issApuration.findFirst({
      where: { company_id: companyId, year, month, metadeleted: false },
    });
    if (!issApuration || issApuration.status === TaxApurationStatus.OPEN) {
      try {
        await this.calculateIss({ company_id: companyId, year, month }, current);
        issApuration = await this.prisma.issApuration.findFirst({
          where: { company_id: companyId, year, month, metadeleted: false },
        });
      } catch (err: any) {
        // Se falhar (ex: sem dados), continua com null
      }
    }

    // 2) Busca GGR mensal de cada marca para fazer rateio proporcional
    const brandWhere: any = { company_id: companyId, metadeleted: false };
    let brands = await this.prisma.brand.findMany({ where: brandWhere, orderBy: { name: 'asc' } });
    if (brandId) brands = brands.filter(b => b.id === brandId);

    const ggrApurations = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id: companyId, year, month, metadeleted: false },
    });
    const ggrByBrand: Record<string, bigint> = {};
    let totalGgr = 0n;
    for (const a of ggrApurations) {
      ggrByBrand[a.brand_id] = a.ggr;
      if (a.ggr > 0n) totalGgr += a.ggr;
    }

    const totalIss = issApuration?.iss_amount ?? 0n;
    const baseAmount = issApuration?.base_amount ?? 0n;
    const calcBase = issApuration?.calculation_base ?? taxConfig?.iss_calculation_base ?? 'GGR';
    const issRate = issApuration?.iss_rate ?? taxConfig?.iss_rate ?? 5;

    // 3) Rateio do ISS por marca proporcional ao GGR positivo
    const brandsBreakdown = brands.map(b => {
      const brandGgr = ggrByBrand[b.id] ?? 0n;
      const positiveGgr = brandGgr > 0n ? brandGgr : 0n;
      const ratio = totalGgr > 0n ? Number(positiveGgr) / Number(totalGgr) : 0;
      // Calcula base e ISS proporcionais (rateio)
      const brandBase = totalGgr > 0n ? (baseAmount * positiveGgr) / totalGgr : 0n;
      const brandIss = totalGgr > 0n ? (totalIss * positiveGgr) / totalGgr : 0n;
      return {
        brand_id: b.id,
        brand: { id: b.id, name: b.name },
        ggr: positiveGgr,
        ratio: ratio,
        base_amount: brandBase,
        iss_amount: brandIss,
        has_data: brandGgr > 0n,
      };
    });

    return serializeBigInt({
      company,
      tax_config: taxConfig ? {
        iss_rate: taxConfig.iss_rate,
        iss_calculation_base: taxConfig.iss_calculation_base,
        ggr_methodology: taxConfig.ggr_methodology,
      } : null,
      year, month,
      iss_apuration: issApuration ? {
        id: issApuration.id,
        status: issApuration.status,
        calculation_base: issApuration.calculation_base,
        iss_rate: issApuration.iss_rate,
        ggr_amount: issApuration.ggr_amount,
        bet_tax_amount: issApuration.bet_tax_amount,
        base_amount: issApuration.base_amount,
        iss_amount: issApuration.iss_amount,
      } : null,
      brands_breakdown: brandsBreakdown,
      totals: {
        brands_count: brands.length,
        brands_with_data: brandsBreakdown.filter(b => b.has_data).length,
        ggr_total: totalGgr,
        base_amount: baseAmount,
        iss_amount: totalIss,
        iss_rate: issRate,
        calculation_base: calcBase,
      },
      generated_at: new Date(),
    });
  }

  /** Exporta o relatório de ISS em PDF — visual pronto para envio ao cliente. */
  async exportIssReportPdf(companyId: string, year: number, month: number, current: any, brandId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const report: any = await this.getIssReport(companyId, year, month, current, brandId);
    const PDFDocument = require('pdfkit');
    const monthNamesPt = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fmtBRL = (v: any) => v == null ? '—' : 'R$ ' + (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';
    const baseLabel = report.totals.calculation_base === 'NGR' ? 'NGR (GGR − Lei 14.790)' : 'GGR (Apostas − Prêmios)';

    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    // Cabeçalho
    doc.fillColor('#1c1917').fontSize(8).font('Helvetica').text('APURAÇÃO ISS — IMPOSTO SOBRE SERVIÇOS', { align: 'left' });
    doc.fontSize(20).font('Helvetica-Bold').text(`${monthNamesPt[month]} / ${year}`, { align: 'left' });
    doc.moveUp(2);

    // Empresa (à direita)
    doc.font('Helvetica-Bold').fontSize(11).text(report.company.name, { align: 'right' });
    doc.font('Helvetica').fontSize(9);
    doc.text(`CNPJ ${fmtCnpj(report.company.cnpj || '')}`, { align: 'right' });
    doc.text(`${[report.company.city, report.company.state].filter(Boolean).join('/')}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(802, doc.y).strokeColor('#a8a29e').stroke();
    doc.moveDown(0.5);

    // Badges
    doc.fontSize(8).font('Helvetica');
    const badgeY = doc.y;
    let badgeX = 40;
    const drawBadge = (text: string, fill: string) => {
      const w = doc.widthOfString(text) + 12;
      doc.roundedRect(badgeX, badgeY, w, 14, 2).fillAndStroke(fill, fill);
      doc.fillColor('#ffffff').text(text, badgeX + 6, badgeY + 4);
      badgeX += w + 6;
    };
    drawBadge(`Município: ${[report.company.city, report.company.state].filter(Boolean).join('/') || '—'}`, '#44403c');
    drawBadge(`Base: ${baseLabel}`, '#1e40af');
    drawBadge(`Alíquota: ${report.totals.iss_rate}%`, '#7c2d12');
    doc.fillColor('#1c1917');
    doc.y = badgeY + 22;

    // Cards de totais (3 colunas)
    const cardY = doc.y;
    const cardW = 250; const cardGap = 8;
    const cards = [
      { label: 'GGR DO MÊS', value: fmtBRL(report.totals.ggr_total), color: '#a16207' },
      { label: 'BASE DE CÁLCULO', value: fmtBRL(report.totals.base_amount), color: '#1c1917', subtitle: baseLabel },
      { label: 'ISS A RECOLHER', value: fmtBRL(report.totals.iss_amount), color: '#b91c1c' },
    ];
    cards.forEach((c, i) => {
      const x = 40 + i * (cardW + cardGap);
      doc.roundedRect(x, cardY, cardW, 60, 2).fillAndStroke('#fafaf9', '#e7e5e4');
      doc.fillColor('#78716c').fontSize(7).font('Helvetica').text(c.label, x + 8, cardY + 7);
      doc.fillColor(c.color).fontSize(16).font('Helvetica-Bold').text(c.value, x + 8, cardY + 22, { width: cardW - 16 });
      if ((c as any).subtitle) {
        doc.fillColor('#78716c').fontSize(7).font('Helvetica').text((c as any).subtitle, x + 8, cardY + 47, { width: cardW - 16 });
      }
    });
    doc.y = cardY + 70;
    doc.fillColor('#1c1917');

    // Tabela por marca
    doc.fontSize(11).font('Helvetica-Bold').text('Detalhamento por marca (rateio proporcional ao GGR)', 40, doc.y);
    doc.moveDown(0.3);

    const tblTop = doc.y;
    const cols = [
      { label: 'Marca',           x: 40,  w: 220, align: 'left'  as const },
      { label: 'GGR',             x: 260, w: 130, align: 'right' as const },
      { label: '% do total',      x: 390, w: 80,  align: 'right' as const },
      { label: 'Base ISS',        x: 470, w: 140, align: 'right' as const },
      { label: 'ISS devido',      x: 610, w: 185, align: 'right' as const },
    ];

    doc.rect(40, tblTop, 755, 18).fill('#f5f5f4');
    doc.fillColor('#44403c').fontSize(8).font('Helvetica-Bold');
    cols.forEach(c => doc.text(c.label, c.x + 4, tblTop + 5, { width: c.w - 8, align: c.align }));
    doc.fillColor('#1c1917');
    let rowY = tblTop + 18;

    doc.font('Helvetica').fontSize(8);
    for (const b of report.brands_breakdown) {
      doc.rect(40, rowY, 755, 18).fillAndStroke('#ffffff', '#e7e5e4');
      doc.fillColor('#1c1917');
      const values = [
        b.brand?.name ?? '—',
        fmtBRL(b.ggr),
        b.has_data ? `${(b.ratio * 100).toFixed(2)}%` : '—',
        fmtBRL(b.base_amount),
        fmtBRL(b.iss_amount),
      ];
      cols.forEach((c, i) => doc.text(values[i], c.x + 4, rowY + 5, { width: c.w - 8, align: c.align }));
      rowY += 18;
    }

    // Total row
    doc.rect(40, rowY, 755, 20).fillAndStroke('#f5f5f4', '#a8a29e');
    doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL', cols[0].x + 4, rowY + 6, { width: cols[0].w });
    doc.text(fmtBRL(report.totals.ggr_total), cols[1].x + 4, rowY + 6, { width: cols[1].w - 8, align: 'right' });
    doc.text('100,00%', cols[2].x + 4, rowY + 6, { width: cols[2].w - 8, align: 'right' });
    doc.text(fmtBRL(report.totals.base_amount), cols[3].x + 4, rowY + 6, { width: cols[3].w - 8, align: 'right' });
    doc.text(fmtBRL(report.totals.iss_amount), cols[4].x + 4, rowY + 6, { width: cols[4].w - 8, align: 'right' });
    rowY += 28;

    // Nota legal
    doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(11).text('Base legal e observações', 40, rowY);
    rowY += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#44403c');
    const legalLines = [
      `• ISS sobre serviços de jogos e apostas — Lei Complementar 116/2003, art. 8-A.`,
      `• Alíquotas municipais variam de 2% a 5%. Município sede: ${[report.company.city, report.company.state].filter(Boolean).join('/') || '—'}, alíquota efetiva: ${report.totals.iss_rate}%.`,
      `• Base de cálculo aplicada: ${baseLabel}.`,
      `• ISS é devido ao município da sede do prestador (regra geral). Confirme com a prefeitura local.`,
      `• O rateio por marca é proporcional ao GGR positivo. Marcas com GGR ≤ 0 não geram ISS.`,
    ];
    legalLines.forEach((line, i) => {
      doc.text(line, 40, rowY + i * 13, { width: 755 });
    });

    // Footer
    const footY = 555;
    doc.moveTo(40, footY).lineTo(802, footY).strokeColor('#e7e5e4').stroke();
    doc.fontSize(7).fillColor('#78716c');
    doc.text(`Gerado em ${new Date(report.generated_at).toLocaleString('pt-BR')}`, 40, footY + 5);

    doc.end();
    await done;
    const buffer = Buffer.concat(chunks);
    const safeName = (report.company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    const filename = `apuracao-iss-${safeName}-${String(month).padStart(2, '0')}-${year}.pdf`;
    return { buffer, filename };
  }

  /** Exporta o relatório de ISS em Excel (.xlsx). */
  async exportIssReportXlsx(companyId: string, year: number, month: number, current: any, brandId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const report: any = await this.getIssReport(companyId, year, month, current, brandId);
    const XLSX = require('xlsx');
    const monthNamesPt = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fmtBRL = (v: any) => v == null ? '' : (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';
    const baseLabel = report.totals.calculation_base === 'NGR' ? 'NGR (GGR − Lei 14.790)' : 'GGR (Apostas − Prêmios)';

    const resumo: any[][] = [
      ['RELATÓRIO DE APURAÇÃO MENSAL DE ISS'],
      [`Período: ${monthNamesPt[month]}/${year}`],
      [''],
      ['DADOS DA EMPRESA'],
      ['Razão Social', report.company.name],
      ['CNPJ', fmtCnpj(report.company.cnpj || '')],
      ['Município sede', [report.company.city, report.company.state].filter(Boolean).join('/')],
      [''],
      ['CONFIGURAÇÃO DO ISS'],
      ['Base de cálculo', baseLabel],
      ['Alíquota (%)', String(report.totals.iss_rate)],
      [''],
      ['CONSOLIDADO'],
      ['GGR do mês (R$)',          fmtBRL(report.totals.ggr_total)],
      ['Base de cálculo (R$)',     fmtBRL(report.totals.base_amount)],
      ['ISS a recolher (R$)',      fmtBRL(report.totals.iss_amount)],
      [''],
      ['BASE LEGAL'],
      ['Lei Complementar 116/2003, art. 8-A — alíquotas municipais 2% a 5%'],
      ['ISS é devido ao município da sede do prestador.'],
      ['O rateio por marca é proporcional ao GGR positivo.'],
      [''],
      [`Relatório gerado em: ${new Date(report.generated_at).toLocaleString('pt-BR')}`],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(resumo);
    ws1['!cols'] = [{ wch: 30 }, { wch: 50 }];

    const detalhe: any[][] = [['Marca', 'GGR', '% do total', 'Base ISS', 'ISS devido']];
    for (const b of report.brands_breakdown) {
      detalhe.push([
        b.brand?.name ?? '—',
        fmtBRL(b.ggr),
        b.has_data ? `${(b.ratio * 100).toFixed(2)}%` : '—',
        fmtBRL(b.base_amount),
        fmtBRL(b.iss_amount),
      ]);
    }
    detalhe.push([
      'TOTAL',
      fmtBRL(report.totals.ggr_total),
      '100,00%',
      fmtBRL(report.totals.base_amount),
      fmtBRL(report.totals.iss_amount),
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet(detalhe);
    ws2['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');
    XLSX.utils.book_append_sheet(wb, ws2, 'Por Marca');

    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = (report.company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    const filename = `apuracao-iss-${safeName}-${String(month).padStart(2, '0')}-${year}.xlsx`;
    return { buffer, filename };
  }

  // =================== Relatório PIS/COFINS Consolidado ===================

  /**
   * Relatório consolidado de PIS/COFINS para um mês/empresa.
   * Mesmo formato dos relatórios GGR e ISS — pronto para envio ao cliente.
   * Faz rateio por marca proporcional ao GGR positivo (informativo;
   * PIS/COFINS são apurados pelo CNPJ).
   */
  async getPisCofinsReport(companyId: string, year: number, month: number, current: any, brandId?: string) {
    if (!companyId) throw new BadRequestException('Empresa obrigatória.');
    if (month < 1 || month > 12) throw new BadRequestException('Mês inválido.');

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, cnpj: true, city: true, state: true, tax_regime: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new ForbiddenException('Sem acesso a esta empresa.');
    }

    const taxConfig = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: companyId } });

    // 1) Garante que PIS/COFINS está calculado
    let apuration = await this.prisma.pisCofinsApuration.findFirst({
      where: { company_id: companyId, year, month, metadeleted: false },
    });
    if (!apuration || apuration.status === TaxApurationStatus.OPEN) {
      try {
        await this.calculatePisCofins({ company_id: companyId, year, month }, current);
        apuration = await this.prisma.pisCofinsApuration.findFirst({
          where: { company_id: companyId, year, month, metadeleted: false },
        });
      } catch (err: any) { /* sem dados, segue */ }
    }

    // 2) GGR por marca para rateio
    let brands = await this.prisma.brand.findMany({
      where: { company_id: companyId, metadeleted: false },
      orderBy: { name: 'asc' },
    });
    if (brandId) brands = brands.filter(b => b.id === brandId);

    const ggrApurations = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id: companyId, year, month, metadeleted: false },
    });
    const ggrByBrand: Record<string, bigint> = {};
    let totalPositiveGgr = 0n;
    for (const a of ggrApurations) {
      ggrByBrand[a.brand_id] = a.ggr;
      if (a.ggr > 0n) totalPositiveGgr += a.ggr;
    }

    const totalRevenue = apuration?.total_revenue ?? 0n;
    const pisAmount = apuration?.pis_amount ?? 0n;
    const cofinsAmount = apuration?.cofins_amount ?? 0n;
    const pisCredits = apuration?.pis_credits ?? 0n;
    const cofinsCredits = apuration?.cofins_credits ?? 0n;
    const pisPayable = apuration?.pis_amount_payable ?? 0n;
    const cofinsPayable = apuration?.cofins_amount_payable ?? 0n;

    // 3) Rateio do PIS/COFINS por marca proporcional ao GGR positivo
    const brandsBreakdown = brands.map(b => {
      const brandGgr = ggrByBrand[b.id] ?? 0n;
      const positiveGgr = brandGgr > 0n ? brandGgr : 0n;
      const ratio = totalPositiveGgr > 0n ? Number(positiveGgr) / Number(totalPositiveGgr) : 0;
      const brandRevenue = totalPositiveGgr > 0n ? (totalRevenue * positiveGgr) / totalPositiveGgr : 0n;
      const brandPis = totalPositiveGgr > 0n ? (pisPayable * positiveGgr) / totalPositiveGgr : 0n;
      const brandCofins = totalPositiveGgr > 0n ? (cofinsPayable * positiveGgr) / totalPositiveGgr : 0n;
      return {
        brand_id: b.id,
        brand: { id: b.id, name: b.name },
        ggr: positiveGgr,
        ratio,
        revenue: brandRevenue,
        pis_amount: brandPis,
        cofins_amount: brandCofins,
        total: brandPis + brandCofins,
        has_data: brandGgr > 0n,
      };
    });

    return serializeBigInt({
      company,
      tax_config: taxConfig ? {
        pis_rate: taxConfig.pis_rate,
        cofins_rate: taxConfig.cofins_rate,
        pis_cofins_regime: taxConfig.pis_cofins_regime,
        ggr_methodology: taxConfig.ggr_methodology,
      } : null,
      year, month,
      brand_filter: brandId ?? null,
      apuration: apuration ? {
        id: apuration.id,
        status: apuration.status,
        regime: apuration.pis_cofins_regime,
        ggr_revenue: apuration.ggr_revenue,
        other_revenue: apuration.other_revenue,
        total_revenue: apuration.total_revenue,
        expenses_with_credit: apuration.expenses_with_credit,
        pis_rate: apuration.pis_rate,
        pis_amount: apuration.pis_amount,
        pis_credits: apuration.pis_credits,
        pis_amount_payable: apuration.pis_amount_payable,
        cofins_rate: apuration.cofins_rate,
        cofins_amount: apuration.cofins_amount,
        cofins_credits: apuration.cofins_credits,
        cofins_amount_payable: apuration.cofins_amount_payable,
      } : null,
      brands_breakdown: brandsBreakdown,
      totals: {
        brands_count: brands.length,
        brands_with_data: brandsBreakdown.filter(b => b.has_data).length,
        ggr_total: totalPositiveGgr,
        total_revenue: totalRevenue,
        pis_amount: pisAmount,
        pis_credits: pisCredits,
        pis_amount_payable: pisPayable,
        cofins_amount: cofinsAmount,
        cofins_credits: cofinsCredits,
        cofins_amount_payable: cofinsPayable,
        total_payable: pisPayable + cofinsPayable,
        pis_rate: apuration?.pis_rate ?? taxConfig?.pis_rate ?? 1.65,
        cofins_rate: apuration?.cofins_rate ?? taxConfig?.cofins_rate ?? 7.6,
        regime: apuration?.pis_cofins_regime ?? taxConfig?.pis_cofins_regime ?? 'NAO_CUMULATIVO',
      },
      generated_at: new Date(),
    });
  }

  /** Exporta PIS/COFINS em PDF. */
  async exportPisCofinsReportPdf(companyId: string, year: number, month: number, current: any, brandId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const report: any = await this.getPisCofinsReport(companyId, year, month, current, brandId);
    const PDFDocument = require('pdfkit');
    const monthNamesPt = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fmtBRL = (v: any) => v == null ? '—' : 'R$ ' + (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';
    const regimeLabel = report.totals.regime === 'NAO_CUMULATIVO' ? 'Não Cumulativo (1,65% + 7,60%)' : 'Cumulativo (0,65% + 3,00%)';

    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    doc.fillColor('#1c1917').fontSize(8).font('Helvetica').text('APURAÇÃO PIS / COFINS — RECEITA FEDERAL', { align: 'left' });
    doc.fontSize(20).font('Helvetica-Bold').text(`${monthNamesPt[month]} / ${year}`, { align: 'left' });
    doc.moveUp(2);

    doc.font('Helvetica-Bold').fontSize(11).text(report.company.name, { align: 'right' });
    doc.font('Helvetica').fontSize(9);
    doc.text(`CNPJ ${fmtCnpj(report.company.cnpj || '')}`, { align: 'right' });
    doc.text(`${[report.company.city, report.company.state].filter(Boolean).join('/')}`, { align: 'right' });
    if (brandId && report.brands_breakdown[0]) {
      doc.fillColor('#7c2d12').font('Helvetica-Bold').text(`Marca: ${report.brands_breakdown[0].brand.name}`, { align: 'right' });
      doc.fillColor('#1c1917').font('Helvetica');
    }
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(802, doc.y).strokeColor('#a8a29e').stroke();
    doc.moveDown(0.5);

    // Badges
    doc.fontSize(8).font('Helvetica');
    const badgeY = doc.y;
    let badgeX = 40;
    const drawBadge = (text: string, fill: string) => {
      const w = doc.widthOfString(text) + 12;
      doc.roundedRect(badgeX, badgeY, w, 14, 2).fillAndStroke(fill, fill);
      doc.fillColor('#ffffff').text(text, badgeX + 6, badgeY + 4);
      badgeX += w + 6;
    };
    drawBadge(`Regime: ${regimeLabel}`, '#1e40af');
    drawBadge(`PIS: ${report.totals.pis_rate}%`, '#a16207');
    drawBadge(`COFINS: ${report.totals.cofins_rate}%`, '#a16207');
    doc.fillColor('#1c1917');
    doc.y = badgeY + 22;

    // Cards (4)
    const cardY = doc.y;
    const cardW = 180; const cardGap = 8;
    const cards = [
      { label: 'GGR (BASE)', value: fmtBRL(report.totals.ggr_total), color: '#a16207' },
      { label: 'PIS A RECOLHER', value: fmtBRL(report.totals.pis_amount_payable), color: '#b91c1c' },
      { label: 'COFINS A RECOLHER', value: fmtBRL(report.totals.cofins_amount_payable), color: '#b91c1c' },
      { label: 'TOTAL PIS/COFINS', value: fmtBRL(report.totals.total_payable), color: '#7f1d1d' },
    ];
    cards.forEach((c, i) => {
      const x = 40 + i * (cardW + cardGap);
      doc.roundedRect(x, cardY, cardW, 50, 2).fillAndStroke('#fafaf9', '#e7e5e4');
      doc.fillColor('#78716c').fontSize(7).font('Helvetica').text(c.label, x + 8, cardY + 7);
      doc.fillColor(c.color).fontSize(14).font('Helvetica-Bold').text(c.value, x + 8, cardY + 22, { width: cardW - 16 });
    });
    doc.y = cardY + 60;
    doc.fillColor('#1c1917');

    // Composição
    doc.fontSize(11).font('Helvetica-Bold').text('Composição da apuração', 40, doc.y);
    doc.moveDown(0.3);
    const compRows = [
      ['GGR (com metodologia aplicada)', fmtBRL(report.apuration?.ggr_revenue ?? 0)],
      ['Outras receitas operacionais', fmtBRL(report.apuration?.other_revenue ?? 0)],
      ['Receita total (base)', fmtBRL(report.apuration?.total_revenue ?? 0)],
      ['Despesas com crédito (Não Cumulativo)', fmtBRL(report.apuration?.expenses_with_credit ?? 0)],
      [`PIS bruto (${report.totals.pis_rate}%)`, fmtBRL(report.apuration?.pis_amount ?? 0)],
      ['(−) Créditos PIS', fmtBRL(report.apuration?.pis_credits ?? 0)],
      ['PIS a recolher', fmtBRL(report.apuration?.pis_amount_payable ?? 0)],
      [`COFINS bruto (${report.totals.cofins_rate}%)`, fmtBRL(report.apuration?.cofins_amount ?? 0)],
      ['(−) Créditos COFINS', fmtBRL(report.apuration?.cofins_credits ?? 0)],
      ['COFINS a recolher', fmtBRL(report.apuration?.cofins_amount_payable ?? 0)],
    ];
    doc.font('Helvetica').fontSize(9);
    const startY = doc.y;
    compRows.forEach((r, i) => {
      const y = startY + i * 14;
      doc.fillColor('#44403c').text(r[0], 40, y, { width: 380 });
      doc.fillColor('#1c1917').font('Helvetica-Bold').text(r[1], 420, y, { width: 130, align: 'right' });
      doc.font('Helvetica');
    });
    let rowY = startY + compRows.length * 14 + 20;

    // Tabela por marca (rateio)
    doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(11).text('Rateio proporcional por marca', 40, rowY);
    rowY += 16;

    const tblTop = rowY;
    const cols = [
      { label: 'Marca',          x: 40,  w: 200, align: 'left'  as const },
      { label: '% do GGR',       x: 240, w: 80,  align: 'right' as const },
      { label: 'GGR',            x: 320, w: 130, align: 'right' as const },
      { label: 'PIS',            x: 450, w: 110, align: 'right' as const },
      { label: 'COFINS',         x: 560, w: 110, align: 'right' as const },
      { label: 'Total',          x: 670, w: 125, align: 'right' as const },
    ];
    doc.rect(40, tblTop, 755, 18).fill('#f5f5f4');
    doc.fillColor('#44403c').fontSize(8).font('Helvetica-Bold');
    cols.forEach(c => doc.text(c.label, c.x + 4, tblTop + 5, { width: c.w - 8, align: c.align }));
    doc.fillColor('#1c1917');
    rowY = tblTop + 18;
    doc.font('Helvetica').fontSize(8);
    for (const b of report.brands_breakdown) {
      doc.rect(40, rowY, 755, 18).fillAndStroke('#ffffff', '#e7e5e4');
      doc.fillColor('#1c1917');
      const values = [
        b.brand?.name ?? '—',
        b.has_data ? `${(b.ratio * 100).toFixed(2)}%` : '—',
        fmtBRL(b.ggr),
        fmtBRL(b.pis_amount),
        fmtBRL(b.cofins_amount),
        fmtBRL(b.total),
      ];
      cols.forEach((c, i) => doc.text(values[i], c.x + 4, rowY + 5, { width: c.w - 8, align: c.align }));
      rowY += 18;
    }
    if (!brandId) {
      doc.rect(40, rowY, 755, 20).fillAndStroke('#f5f5f4', '#a8a29e');
      doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(8);
      const totals = ['TOTAL', '100,00%', fmtBRL(report.totals.ggr_total), fmtBRL(report.totals.pis_amount_payable), fmtBRL(report.totals.cofins_amount_payable), fmtBRL(report.totals.total_payable)];
      cols.forEach((c, i) => doc.text(totals[i], c.x + 4, rowY + 6, { width: c.w - 8, align: c.align }));
      rowY += 28;
    }

    const footY = 555;
    doc.moveTo(40, footY).lineTo(802, footY).strokeColor('#e7e5e4').stroke();
    doc.fontSize(7).fillColor('#78716c');
    doc.text(`Gerado em ${new Date(report.generated_at).toLocaleString('pt-BR')}`, 40, footY + 5);
    doc.text(`Regime: ${regimeLabel} · PIS/COFINS são federais — recolhimento em DARF`, 40, footY + 5, { align: 'right' });

    doc.end();
    await done;
    const buffer = Buffer.concat(chunks);
    const safeName = (report.company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 30);
    const brandSuffix = brandId && report.brands_breakdown[0] ? `-${report.brands_breakdown[0].brand.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 30)}` : '';
    return { buffer, filename: `apuracao-pis-cofins-${safeName}${brandSuffix}-${String(month).padStart(2, '0')}-${year}.pdf` };
  }

  /** Exporta PIS/COFINS em Excel. */
  async exportPisCofinsReportXlsx(companyId: string, year: number, month: number, current: any, brandId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const report: any = await this.getPisCofinsReport(companyId, year, month, current, brandId);
    const XLSX = require('xlsx');
    const monthNamesPt = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fmtBRL = (v: any) => v == null ? '' : (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';

    const resumo: any[][] = [
      ['RELATÓRIO DE APURAÇÃO PIS/COFINS'],
      [`Período: ${monthNamesPt[month]}/${year}`],
      [''],
      ['DADOS DA EMPRESA'],
      ['Razão Social', report.company.name],
      ['CNPJ', fmtCnpj(report.company.cnpj || '')],
      ...(brandId && report.brands_breakdown[0] ? [['Marca filtrada', report.brands_breakdown[0].brand.name]] : []),
      [''],
      ['CONFIGURAÇÃO'],
      ['Regime', report.totals.regime],
      ['PIS (%)', String(report.totals.pis_rate)],
      ['COFINS (%)', String(report.totals.cofins_rate)],
      [''],
      ['COMPOSIÇÃO DA BASE'],
      ['GGR (com metodologia)', fmtBRL(report.apuration?.ggr_revenue ?? 0)],
      ['Outras receitas operacionais', fmtBRL(report.apuration?.other_revenue ?? 0)],
      ['Receita total', fmtBRL(report.apuration?.total_revenue ?? 0)],
      ['Despesas com crédito', fmtBRL(report.apuration?.expenses_with_credit ?? 0)],
      [''],
      ['APURAÇÃO PIS'],
      ['PIS bruto', fmtBRL(report.apuration?.pis_amount ?? 0)],
      ['Créditos PIS', fmtBRL(report.apuration?.pis_credits ?? 0)],
      ['PIS a recolher', fmtBRL(report.apuration?.pis_amount_payable ?? 0)],
      [''],
      ['APURAÇÃO COFINS'],
      ['COFINS bruto', fmtBRL(report.apuration?.cofins_amount ?? 0)],
      ['Créditos COFINS', fmtBRL(report.apuration?.cofins_credits ?? 0)],
      ['COFINS a recolher', fmtBRL(report.apuration?.cofins_amount_payable ?? 0)],
      [''],
      ['TOTAL PIS+COFINS A RECOLHER', fmtBRL(report.totals.total_payable)],
      [''],
      [`Relatório gerado em: ${new Date(report.generated_at).toLocaleString('pt-BR')}`],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(resumo);
    ws1['!cols'] = [{ wch: 30 }, { wch: 50 }];

    const detalhe: any[][] = [['Marca', '% do GGR', 'GGR', 'PIS', 'COFINS', 'Total']];
    for (const b of report.brands_breakdown) {
      detalhe.push([
        b.brand?.name ?? '—',
        b.has_data ? `${(b.ratio * 100).toFixed(2)}%` : '—',
        fmtBRL(b.ggr),
        fmtBRL(b.pis_amount),
        fmtBRL(b.cofins_amount),
        fmtBRL(b.total),
      ]);
    }
    if (!brandId) {
      detalhe.push(['TOTAL', '100,00%', fmtBRL(report.totals.ggr_total), fmtBRL(report.totals.pis_amount_payable), fmtBRL(report.totals.cofins_amount_payable), fmtBRL(report.totals.total_payable)]);
    }
    const ws2 = XLSX.utils.aoa_to_sheet(detalhe);
    ws2['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');
    XLSX.utils.book_append_sheet(wb, ws2, 'Por Marca');

    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = (report.company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 30);
    const brandSuffix = brandId && report.brands_breakdown[0] ? `-${report.brands_breakdown[0].brand.name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 30)}` : '';
    return { buffer, filename: `apuracao-pis-cofins-${safeName}${brandSuffix}-${String(month).padStart(2, '0')}-${year}.xlsx` };
  }

  // =================== Lista unificada ===================

  async listAllApurations(filters: any, current: any) {
    const tenant = buildTenantWhere(current, {}, { allowOwner: false });
    tenant.metadeleted = false;
    // ADMIN pode filtrar por empresa específica; MANAGER já é restrito pelo tenant
    if (filters.company_id && current.profile === Profile.ADMIN) {
      tenant.company_id = filters.company_id;
    }
    const taxType: string | undefined = filters.tax_type;
    const year = filters.year ? parseInt(filters.year) : undefined;
    const month = filters.month ? parseInt(filters.month) : undefined;
    const status = filters.status as string | undefined;

    const out: any[] = [];

    // IRPJ/CSLL — month filter casa com quarter (trimestre que contém o mês) ou month direto
    if (!taxType || taxType === 'IRPJ_CSLL') {
      const w: any = { ...tenant };
      if (year) w.year = year;
      if (status) w.status = status;
      if (month) {
        const q = Math.floor((month - 1) / 3) + 1;
        w.OR = [{ month }, { quarter: q }];
      }
      const items = await this.prisma.irpjCsllApuration.findMany({
        where: w,
        include: { company: { select: { id: true, name: true } } },
        orderBy: [{ year: 'desc' }, { quarter: 'desc' }, { month: 'desc' }],
        take: 200,
      });
      for (const a of items) {
        out.push({
          id: a.id,
          source_id: a.id,
          tax_type: 'IRPJ_CSLL',
          period_type: a.period_type,
          year: a.year,
          quarter: a.quarter,
          month: a.month,
          base_amount: a.taxable_profit.toString(),
          tax_amount: a.total_taxes.toString(),
          status: a.status,
          company: a.company,
          created_at: a.created_at,
        });
      }
    }

    if (!taxType || taxType === 'PIS_COFINS') {
      const w: any = { ...tenant };
      if (year) w.year = year;
      if (month) w.month = month;
      if (status) w.status = status;
      const items = await this.prisma.pisCofinsApuration.findMany({
        where: w,
        include: { company: { select: { id: true, name: true } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 200,
      });
      for (const a of items) {
        out.push({
          id: a.id,
          source_id: a.id,
          tax_type: 'PIS_COFINS',
          period_type: 'MENSAL',
          year: a.year,
          quarter: null,
          month: a.month,
          base_amount: a.total_revenue.toString(),
          tax_amount: a.total_taxes.toString(),
          status: a.status,
          company: a.company,
          created_at: a.created_at,
        });
      }
    }

    if (!taxType || taxType === 'ISS') {
      const w: any = { ...tenant };
      if (year) w.year = year;
      if (month) w.month = month;
      if (status) w.status = status;
      const items = await this.prisma.issApuration.findMany({
        where: w,
        include: { company: { select: { id: true, name: true } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 200,
      });
      for (const a of items) {
        out.push({
          id: a.id,
          source_id: a.id,
          tax_type: 'ISS',
          period_type: 'MENSAL',
          year: a.year,
          quarter: null,
          month: a.month,
          base_amount: a.base_amount.toString(),
          tax_amount: a.iss_amount.toString(),
          status: a.status,
          calculation_base: a.calculation_base,
          company: a.company,
          created_at: a.created_at,
        });
      }
    }

    out.sort((a, b) => (b.year - a.year) || ((b.month ?? b.quarter ?? 0) - (a.month ?? a.quarter ?? 0)));
    return { data: out, total: out.length };
  }

  // =================== Retenções CSRF (Serviços PJ→PJ) ===================
  // Lista, por mês × tributo, totais retidos nos payables PJ vs DARFs gerados
  // vs. valores efetivamente pagos. Usado para conciliação/auditoria.
  async listWithholdings(filters: any, current: any) {
    const tenant = buildTenantWhere(current, {}, { allowOwner: false });
    tenant.metadeleted = false;
    if (filters.company_id && current.profile === Profile.ADMIN) {
      tenant.company_id = filters.company_id;
    }
    const year = filters.year ? parseInt(filters.year) : undefined;

    // 1. Total retido nos payables PJ→PJ (origem das obrigações)
    const pjPayables = await this.prisma.accountPayable.findMany({
      where: { ...tenant, is_service_from_pj: true },
      select: {
        company_id: true, issue_date: true,
        irrf_retained: true, csll_retained: true,
        pis_retained: true, cofins_retained: true,
        company: { select: { id: true, name: true } },
      },
    });

    type Bucket = {
      company_id: string; company_name: string;
      year: number; month: number;
      retained: { irrf: bigint; csll: bigint; pis: bigint; cofins: bigint };
      darf:     { irrf: bigint; csll: bigint; pis: bigint; cofins: bigint };
      paid:     { irrf: bigint; csll: bigint; pis: bigint; cofins: bigint };
      darf_status: { irrf: string | null; csll: string | null; pis: string | null; cofins: string | null };
      darf_payable_id: { irrf: string | null; csll: string | null; pis: string | null; cofins: string | null };
      darf_due_date: { irrf: string | null; csll: string | null; pis: string | null; cofins: string | null };
    };
    const buckets = new Map<string, Bucket>();
    const ensure = (companyId: string, companyName: string, y: number, m: number): Bucket => {
      const key = `${companyId}|${y}-${m}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          company_id: companyId, company_name: companyName,
          year: y, month: m,
          retained: { irrf: 0n, csll: 0n, pis: 0n, cofins: 0n },
          darf:     { irrf: 0n, csll: 0n, pis: 0n, cofins: 0n },
          paid:     { irrf: 0n, csll: 0n, pis: 0n, cofins: 0n },
          darf_status: { irrf: null, csll: null, pis: null, cofins: null },
          darf_payable_id: { irrf: null, csll: null, pis: null, cofins: null },
          darf_due_date: { irrf: null, csll: null, pis: null, cofins: null },
        });
      }
      return buckets.get(key)!;
    };

    for (const r of pjPayables) {
      const y = r.issue_date.getFullYear();
      const m = r.issue_date.getMonth() + 1;
      if (year && y !== year) continue;
      const b = ensure(r.company_id, r.company.name, y, m);
      b.retained.irrf   += r.irrf_retained;
      b.retained.csll   += r.csll_retained;
      b.retained.pis    += r.pis_retained;
      b.retained.cofins += r.cofins_retained;
    }

    // 2. DARFs de retenção CSRF (1 AccountPayable por (mês, tributo))
    const darfs = await this.prisma.accountPayable.findMany({
      where: {
        ...tenant,
        source: 'TAX_APURATION',
        description: { contains: 'Retenção CSRF', mode: 'insensitive' },
      },
      select: {
        id: true,
        company_id: true, description: true, amount: true, paid_amount: true,
        status: true, due_date: true, payment_date: true,
        company: { select: { id: true, name: true } },
      },
    });

    // Pattern: "DARF Retenção CSRF — IRRF — 03/2026 (cód. 1708)"
    const monthRegex = /(\d{2})\/(\d{4})/;
    for (const d of darfs) {
      const monthMatch = d.description.match(monthRegex);
      if (!monthMatch) continue;
      const m = parseInt(monthMatch[1]);
      const y = parseInt(monthMatch[2]);
      if (year && y !== year) continue;

      let trib: 'irrf' | 'csll' | 'pis' | 'cofins' | null = null;
      if (/IRRF/i.test(d.description)) trib = 'irrf';
      else if (/CSLL/i.test(d.description)) trib = 'csll';
      else if (/COFINS/i.test(d.description)) trib = 'cofins';
      else if (/\bPIS\b/i.test(d.description)) trib = 'pis';
      if (!trib) continue;

      const b = ensure(d.company_id, d.company.name, y, m);
      b.darf[trib] = d.amount;
      b.paid[trib] = d.paid_amount;
      b.darf_status[trib] = d.status;
      b.darf_payable_id[trib] = d.id;
      b.darf_due_date[trib] = d.due_date.toISOString();
    }

    // 3. Serializa, calculando alertas
    const TOLERANCE_CENTS = 100n; // R$ 1,00 — apenas arredondamento
    const data = Array.from(buckets.values()).map(b => {
      const tributos = ['irrf', 'csll', 'pis', 'cofins'] as const;
      const breakdown = tributos.map(t => {
        const ret = b.retained[t];
        const darf = b.darf[t];
        const paid = b.paid[t];
        const diffRetDarf = ret - darf; // se positivo, retido > DARF (faltou DARF)
        const hasAlert = diffRetDarf < -TOLERANCE_CENTS || diffRetDarf > TOLERANCE_CENTS;
        return {
          tributo: t,
          retained: ret.toString(),
          darf_amount: darf.toString(),
          paid_amount: paid.toString(),
          darf_status: b.darf_status[t],
          darf_payable_id: b.darf_payable_id[t],
          darf_due_date: b.darf_due_date[t],
          diff_retained_darf: diffRetDarf.toString(),
          alert: hasAlert ? (ret > darf ? 'MISSING_DARF' : 'OVER_DARF') : null,
        };
      });
      const totalRetained = tributos.reduce((s, t) => s + b.retained[t], 0n);
      const totalDarf = tributos.reduce((s, t) => s + b.darf[t], 0n);
      const totalPaid = tributos.reduce((s, t) => s + b.paid[t], 0n);
      return {
        company_id: b.company_id,
        company_name: b.company_name,
        year: b.year,
        month: b.month,
        total_retained: totalRetained.toString(),
        total_darf: totalDarf.toString(),
        total_paid: totalPaid.toString(),
        breakdown,
        has_alert: breakdown.some(b => b.alert !== null),
      };
    });

    data.sort((a, b) => (b.year - a.year) || (b.month - a.month) || a.company_name.localeCompare(b.company_name));
    return { data, total: data.length };
  }
}

// =================== CONTROLLER ===================

@ApiTags('tax')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('tax')
export class TaxController {
  constructor(private service: TaxService) {}

  @Profiles(Profile.ADMIN)
  @Get('config/:companyId')
  getConfig(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.getTaxConfig(companyId, user);
  }

  @Profiles(Profile.ADMIN)
  @Post('config')
  upsertConfig(@Body() dto: UpsertTaxConfigDto, @CurrentUser() user: any) {
    return this.service.upsertTaxConfig(dto, user);
  }

  /** Gera o PDF do termo de responsabilidade pré-preenchido. */
  @Profiles(Profile.ADMIN)
  @Get('config/:companyId/ggr-term-pdf')
  async downloadGgrTerm(
    @Param('companyId') companyId: string,
    @Query('methodology') methodology: GgrMethodology,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const m = methodology ?? GgrMethodology.DEDUCT_CASHBACK;
    const { buffer, filename } = await this.service.generateGgrTermPdf(companyId, m, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** Upload do termo assinado (PDF base64). Ativa a metodologia escolhida. */
  @Profiles(Profile.ADMIN)
  @Post('config/ggr-term-upload')
  uploadGgrTerm(@Body() dto: UploadGgrTermDto, @CurrentUser() user: any) {
    return this.service.uploadGgrTerm(dto, user);
  }

  /** Download do PDF assinado armazenado (consulta posterior). */
  @Profiles(Profile.ADMIN)
  @Get('config/:companyId/ggr-term-signed')
  async downloadSignedGgrTerm(
    @Param('companyId') companyId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const buf = await this.service.getGgrTermPdf(companyId, user);
    if (!buf) {
      res.status(404).json({ message: 'Nenhum termo assinado nesta empresa.' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="termo-ggr-assinado.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('irpj/calculate')
  calculate(@Body() dto: CalculateIrpjDto, @CurrentUser() user: any) {
    return this.service.calculateIrpjCsll(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('irpj')
  list(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listIrpjApurations(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('irpj/:id')
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getIrpjApuration(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('irpj/:id/close')
  close(@Param('id') id: string, @Body() dto: CloseIrpjDto, @CurrentUser() user: any) {
    return this.service.closeIrpjApuration(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('irpj/:id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.reopenIrpjApuration(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('irpj/:id/lalur')
  addAdjustment(@Param('id') id: string, @Body() dto: LalurAdjustmentDto, @CurrentUser() user: any) {
    return this.service.addLalurAdjustment(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete('lalur/:id')
  deleteAdjustment(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteLalurAdjustment(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch('payables/:id/flags')
  updatePayableFlags(@Param('id') id: string, @Body() dto: UpdatePayableTaxDto, @CurrentUser() user: any) {
    return this.service.updatePayableTaxFlags(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('ggr/:apurationId/recalculate-pis-cofins')
  recalcGgr(@Param('apurationId') apurationId: string, @CurrentUser() user: any) {
    return this.service.recalculatePisCofinsForGgr(apurationId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('pis-cofins/calculate')
  calculatePisCofins(@Body() dto: CalculatePisCofinsDto, @CurrentUser() user: any) {
    return this.service.calculatePisCofins(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('iss/calculate')
  calculateIss(@Body() dto: CalculateIssDto, @CurrentUser() user: any) {
    return this.service.calculateIss(dto, user);
  }

  /** Relatório consolidado de ISS (filtro opcional ?brand_id=). */
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('iss/report/:companyId/:year/:month')
  getIssReport(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.service.getIssReport(companyId, parseInt(year), parseInt(month), user, brandId);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('iss/report/:companyId/:year/:month/export')
  async exportIssReport(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportIssReportXlsx(companyId, parseInt(year), parseInt(month), user, brandId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('iss/report/:companyId/:year/:month/export-pdf')
  async exportIssReportPdf(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportIssReportPdf(companyId, parseInt(year), parseInt(month), user, brandId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** Relatório consolidado de PIS/COFINS (filtro opcional ?brand_id=). */
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('pis-cofins/report/:companyId/:year/:month')
  getPisCofinsReport(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.service.getPisCofinsReport(companyId, parseInt(year), parseInt(month), user, brandId);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('pis-cofins/report/:companyId/:year/:month/export')
  async exportPisCofinsReport(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportPisCofinsReportXlsx(companyId, parseInt(year), parseInt(month), user, brandId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('pis-cofins/report/:companyId/:year/:month/export-pdf')
  async exportPisCofinsReportPdf(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportPisCofinsReportPdf(companyId, parseInt(year), parseInt(month), user, brandId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('apurations')
  listAllApurations(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listAllApurations(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('withholdings')
  listWithholdings(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listWithholdings(q, user);
  }

  /**
   * Sugere alíquota de ISS para uma cidade/UF — usado pela tela de
   * configuração tributária para pré-preencher o iss_rate da empresa.
   * Pode ser chamado também ao criar uma empresa para hint na UI.
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('iss-rate-suggestion')
  suggestIssRate(@Query('city') city: string, @Query('state') state: string) {
    if (!city || !state) {
      throw new BadRequestException('Parâmetros city e state são obrigatórios.');
    }
    return suggestIssRate(city, state);
  }
}

@Module({
  imports: [AccountingModule, GgrModule],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
