import {
  Module, Injectable, NotFoundException, BadRequestException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsEnum, IsInt, MaxLength, Min, Max } from 'class-validator';
import {
  Profile, TaxRegime, PisCofinsRegime, IrpjApurationPeriod, IrpjApurationStatus,
  LalurAdjustmentType, PaymentStatus, TaxApurationStatus, IssCalculationBase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess } from '../financial/tenant.helper';
import { serializeBigInt } from '../financial/money.helper';
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
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
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

    const config = existing
      ? await this.prisma.companyTaxConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.companyTaxConfig.create({ data: { ...data, company_id: dto.company_id } });

    // Mantém Company.tax_regime em sintonia com a config.
    if (data.tax_regime && data.tax_regime !== existing?.tax_regime) {
      await this.prisma.company.update({ where: { id: dto.company_id }, data: { tax_regime: data.tax_regime } });
    }

    await this.audit.log(existing ? 'UPDATE' : 'CREATE', 'TAX_CONFIG', config.id, current.id);
    return serializeBigInt(config);
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

    const ggrRecords = await this.prisma.ggrDailyRecord.findMany({
      where: { company_id: dto.company_id, metadeleted: false, date: { gte: start, lt: end } },
    });
    const ggr_revenue = ggrRecords.reduce((s, r) => s + r.ggr, 0n);

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

    const ggrRecords = await this.prisma.ggrDailyRecord.findMany({
      where: { company_id: dto.company_id, metadeleted: false, date: { gte: start, lt: end } },
    });
    const ggr_amount = ggrRecords.reduce((s, r) => s + r.ggr, 0n);

    // NGR = GGR - tributo da Lei 14.790 (12% sobre GGR). Ver GgrMonthlyApuration.
    const ggrApurations = await this.prisma.ggrMonthlyApuration.findMany({
      where: { company_id: dto.company_id, year: dto.year, month: dto.month, metadeleted: false },
    });
    const bet_tax_amount = ggrApurations.reduce((s, a) => s + a.tax_lei14790_amount, 0n);

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

  // =================== Lista unificada ===================

  async listAllApurations(filters: any, current: any) {
    const tenant = buildTenantWhere(current, {}, { allowOwner: false });
    tenant.metadeleted = false;
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

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('apurations')
  listAllApurations(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listAllApurations(q, user);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
