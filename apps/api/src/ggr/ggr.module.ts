import {
  Module, Injectable, NotFoundException, BadRequestException, ForbiddenException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Res, Header,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsDateString, MaxLength, Min, IsInt } from 'class-validator';
import { Profile, GgrSourceType, GgrApurationStatus, PaymentStatus } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess } from '../financial/tenant.helper';
import { serializeBigInt } from '../financial/money.helper';
import { parseGgrFile, generateGgrTemplateCSV } from './ggr-parser';
import { calculateTaxes, calculatePlayersBalance, checkSegregation } from './tax-calculator';
import { AccountingModule } from '../accounting/accounting.module';
import { JournalPostingService } from '../accounting/journal-posting.service';

class ImportGgrDto {
  @IsString() brand_id: string;
  @IsString() filename: string;
  @IsString() content: string; // CSV em texto OU XLSX em base64
  @IsOptional() @IsString() format?: 'CSV' | 'XLSX';
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ManualGgrDto {
  @IsString() brand_id: string;
  @IsDateString() date: string;
  @IsNumber() @Min(0) total_bets: number;
  @IsNumber() @Min(0) total_prizes: number;
  @IsNumber() @Min(0) total_deposits: number;
  @IsNumber() @Min(0) total_withdrawals: number;
  @IsOptional() @IsInt() @Min(0) bet_count?: number;
  @IsOptional() @IsInt() @Min(0) prize_count?: number;
  @IsOptional() @IsInt() @Min(0) deposit_count?: number;
  @IsOptional() @IsInt() @Min(0) withdrawal_count?: number;
  @IsOptional() @IsInt() @Min(0) active_players?: number;
  @IsOptional() @IsString() notes?: string;
}

class CloseApurationDto {
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
export class GgrService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private posting: JournalPostingService,
  ) {}

  /** Posta lançamento contábil para um GgrDailyRecord; falha silenciosamente. */
  private async safePostGgr(recordId: string) {
    try { await this.posting.postGgrDaily(recordId); }
    catch (e: any) { console.warn(`[GGR posting] ${recordId}: ${e?.message ?? e}`); }
  }
  private async safePostGgrApurationTaxes(apurationId: string) {
    try { await this.posting.postGgrApurationTaxes(apurationId); }
    catch (e: any) { console.warn(`[GGR apuration posting] ${apurationId}: ${e?.message ?? e}`); }
  }

  /**
   * Importa um arquivo CSV/XLSX e cria/atualiza os registros diários.
   * Por causa do constraint UNIQUE (brand_id, date), reimports sobrescrevem.
   */
  async importFile(dto: ImportGgrDto, current: any) {
    const brand = await this.prisma.brand.findUnique({ where: { id: dto.brand_id } });
    if (!brand || brand.metadeleted) throw new BadRequestException('Marca inválida.');
    assertTenantAccess(brand, current);

    let buffer: Buffer | string;
    if (dto.filename.toLowerCase().endsWith('.xlsx') || dto.filename.toLowerCase().endsWith('.xls')) {
      // XLSX vem em base64
      buffer = Buffer.from(dto.content, 'base64');
    } else {
      buffer = dto.content; // CSV em texto
    }

    const parsed = parseGgrFile(dto.filename, buffer);
    if (parsed.lines.length === 0) {
      throw new BadRequestException('Nenhuma linha válida no arquivo.');
    }

    let created = 0;
    let updated = 0;

    for (const line of parsed.lines) {
      // Normaliza data para meia-noite UTC
      const dateOnly = new Date(Date.UTC(
        line.date.getUTCFullYear(),
        line.date.getUTCMonth(),
        line.date.getUTCDate()
      ));

      const ggr = line.total_bets - line.total_prizes;

      const existing = await this.prisma.ggrDailyRecord.findUnique({
        where: { brand_id_date: { brand_id: brand.id, date: dateOnly } },
      });

      const data = {
        date: dateOnly,
        total_bets: line.total_bets,
        total_prizes: line.total_prizes,
        total_deposits: line.total_deposits,
        total_withdrawals: line.total_withdrawals,
        bet_count: line.bet_count ?? 0,
        prize_count: line.prize_count ?? 0,
        deposit_count: line.deposit_count ?? 0,
        withdrawal_count: line.withdrawal_count ?? 0,
        active_players: line.active_players ?? 0,
        ggr,
        source_type: parsed.format === 'XLSX' ? GgrSourceType.XLSX_UPLOAD : GgrSourceType.CSV_UPLOAD,
        source_reference: dto.filename,
        notes: dto.notes,
        imported_by_id: current.id,
        brand_id: brand.id,
        company_id: brand.company_id,
      };

      let savedId: string;
      if (existing) {
        const u = await this.prisma.ggrDailyRecord.update({
          where: { id: existing.id },
          data: { ...data, imported_at: new Date() },
        });
        savedId = u.id;
        updated++;
      } else {
        const c = await this.prisma.ggrDailyRecord.create({ data });
        savedId = c.id;
        created++;
      }
      await this.safePostGgr(savedId);
    }

    await this.audit.log('IMPORT', 'GGR', undefined, current.id, {
      filename: dto.filename, created, updated, total: parsed.lines.length,
    });

    return {
      filename: dto.filename,
      format: parsed.format,
      total_lines: parsed.lines.length,
      created,
      updated,
      warnings: parsed.warnings,
    };
  }

  /**
   * Lançamento manual de GGR para um dia específico (sem upload).
   */
  async createManual(dto: ManualGgrDto, current: any) {
    const brand = await this.prisma.brand.findUnique({ where: { id: dto.brand_id } });
    if (!brand || brand.metadeleted) throw new BadRequestException('Marca inválida.');
    assertTenantAccess(brand, current);

    const dateOnly = new Date(Date.UTC(
      new Date(dto.date).getUTCFullYear(),
      new Date(dto.date).getUTCMonth(),
      new Date(dto.date).getUTCDate()
    ));

    const total_bets = BigInt(dto.total_bets);
    const total_prizes = BigInt(dto.total_prizes);
    const ggr = total_bets - total_prizes;

    const data = {
      date: dateOnly,
      total_bets,
      total_prizes,
      total_deposits: BigInt(dto.total_deposits),
      total_withdrawals: BigInt(dto.total_withdrawals),
      bet_count: dto.bet_count ?? 0,
      prize_count: dto.prize_count ?? 0,
      deposit_count: dto.deposit_count ?? 0,
      withdrawal_count: dto.withdrawal_count ?? 0,
      active_players: dto.active_players ?? 0,
      ggr,
      source_type: GgrSourceType.MANUAL,
      notes: dto.notes,
      imported_by_id: current.id,
      brand_id: brand.id,
      company_id: brand.company_id,
    };

    const record = await this.prisma.ggrDailyRecord.upsert({
      where: { brand_id_date: { brand_id: brand.id, date: dateOnly } },
      create: data,
      update: data,
    });

    await this.audit.log('CREATE', 'GGR_DAILY', record.id, current.id);
    await this.safePostGgr(record.id);
    return serializeBigInt(record);
  }

  async findDaily(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.date_from || filters.date_to) {
      where.date = {};
      if (filters.date_from) where.date.gte = new Date(filters.date_from);
      if (filters.date_to) where.date.lte = new Date(filters.date_to);
    }
    if (filters.year && filters.month) {
      const y = parseInt(filters.year);
      const m = parseInt(filters.month);
      where.date = {
        gte: new Date(Date.UTC(y, m - 1, 1)),
        lt: new Date(Date.UTC(y, m, 1)),
      };
    }

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.ggrDailyRecord.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { brand: { select: { id: true, name: true } } },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.ggrDailyRecord.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async deleteDaily(id: string, current: any) {
    const record = await this.prisma.ggrDailyRecord.findUnique({ where: { id } });
    if (!record || record.metadeleted) throw new NotFoundException('Registro não encontrado.');
    assertTenantAccess(record, current);
    await this.prisma.ggrDailyRecord.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'GGR_DAILY', id, current.id);
    // Remove lançamento contábil correspondente.
    await this.safePostGgr(id);
    return { ok: true };
  }

  async updateDaily(id: string, dto: Partial<ManualGgrDto>, current: any) {
    const record = await this.prisma.ggrDailyRecord.findUnique({ where: { id } });
    if (!record || record.metadeleted) throw new NotFoundException('Registro não encontrado.');
    assertTenantAccess(record, current);

    const data: any = {};
    if (dto.total_bets !== undefined) data.total_bets = BigInt(dto.total_bets);
    if (dto.total_prizes !== undefined) data.total_prizes = BigInt(dto.total_prizes);
    if (dto.total_deposits !== undefined) data.total_deposits = BigInt(dto.total_deposits);
    if (dto.total_withdrawals !== undefined) data.total_withdrawals = BigInt(dto.total_withdrawals);
    if (dto.bet_count !== undefined) data.bet_count = dto.bet_count;
    if (dto.prize_count !== undefined) data.prize_count = dto.prize_count;
    if (dto.deposit_count !== undefined) data.deposit_count = dto.deposit_count;
    if (dto.withdrawal_count !== undefined) data.withdrawal_count = dto.withdrawal_count;
    if (dto.active_players !== undefined) data.active_players = dto.active_players;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const newBets = data.total_bets ?? record.total_bets;
    const newPrizes = data.total_prizes ?? record.total_prizes;
    data.ggr = newBets - newPrizes;

    const updated = await this.prisma.ggrDailyRecord.update({ where: { id }, data });
    await this.audit.log('UPDATE', 'GGR_DAILY', id, current.id);
    await this.safePostGgr(updated.id);
    return serializeBigInt(updated);
  }

  async deleteApuration(id: string, current: any) {
    const a = await this.prisma.ggrMonthlyApuration.findUnique({ where: { id } });
    if (!a || a.metadeleted) throw new NotFoundException('Apuração não encontrada.');
    assertTenantAccess(a, current);
    if (a.status !== GgrApurationStatus.OPEN) {
      throw new BadRequestException('Apenas apurações em aberto podem ser excluídas. Reabra antes de excluir.');
    }
    await this.prisma.ggrMonthlyApuration.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'GGR_APURATION', id, current.id);
    return { ok: true };
  }

  /**
   * Apuração mensal — calcula consolidados + impostos, salva ou atualiza.
   */
  async getMonthlyApuration(brandId: string, year: number, month: number, current: any) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || brand.metadeleted) throw new BadRequestException('Marca inválida.');
    assertTenantAccess(brand, current);

    if (month < 1 || month > 12) throw new BadRequestException('Mês inválido.');

    // Pega ou cria a apuração
    let apuration = await this.prisma.ggrMonthlyApuration.findUnique({
      where: { brand_id_year_month: { brand_id: brandId, year, month } },
      include: { brand: { select: { id: true, name: true } } },
    });

    // Se não está fechada, recalcula
    if (!apuration || apuration.status === GgrApurationStatus.OPEN) {
      // Soma os registros diários do mês
      const records = await this.prisma.ggrDailyRecord.findMany({
        where: {
          brand_id: brandId,
          metadeleted: false,
          date: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      });

      const totals = records.reduce(
        (acc, r) => ({
          total_bets: acc.total_bets + r.total_bets,
          total_prizes: acc.total_prizes + r.total_prizes,
          total_deposits: acc.total_deposits + r.total_deposits,
          total_withdrawals: acc.total_withdrawals + r.total_withdrawals,
        }),
        { total_bets: 0n, total_prizes: 0n, total_deposits: 0n, total_withdrawals: 0n },
      );

      // Carrega configuração tributária da empresa para usar as alíquotas reais
      // do regime configurado (NAO_CUMULATIVO 1,65/7,60 ou CUMULATIVO 0,65/3,00).
      const cfg = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: brand.company_id } });
      const pis_rate = cfg ? Number(cfg.pis_rate) : 0.65;
      const cofins_rate = cfg ? Number(cfg.cofins_rate) : 3.0;

      const taxes = calculateTaxes(totals.total_bets, totals.total_prizes, { pis_rate, cofins_rate });

      const apurationData = {
        year,
        month,
        total_bets: totals.total_bets,
        total_prizes: totals.total_prizes,
        total_deposits: totals.total_deposits,
        total_withdrawals: totals.total_withdrawals,
        ggr: taxes.ggr,
        net_revenue: taxes.net_revenue,
        tax_lei14790_amount: taxes.tax_lei14790_amount,
        irrf_taxable_base: taxes.irrf_taxable_base,
        irrf_amount: taxes.irrf_amount,
        pis_rate: taxes.pis_rate,
        pis_amount: taxes.pis_amount,
        cofins_rate: taxes.cofins_rate,
        cofins_amount: taxes.cofins_amount,
        pis_cofins_regime: cfg?.pis_cofins_regime ?? undefined,
        total_taxes: taxes.total_taxes,
        brand_id: brandId,
        company_id: brand.company_id,
      };

      if (apuration) {
        apuration = await this.prisma.ggrMonthlyApuration.update({
          where: { id: apuration.id },
          data: apurationData,
          include: { brand: { select: { id: true, name: true } } },
        });
      } else {
        apuration = await this.prisma.ggrMonthlyApuration.create({
          data: apurationData,
          include: { brand: { select: { id: true, name: true } } },
        });
      }
    }

    // Inclui registros diários
    const dailyRecords = await this.prisma.ggrDailyRecord.findMany({
      where: {
        brand_id: brandId,
        metadeleted: false,
        date: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lt: new Date(Date.UTC(year, month, 1)),
        },
      },
      orderBy: { date: 'asc' },
    });

    // Verifica segregação patrimonial (compara saldo esperado vs saldo bancário)
    const expectedPlayersBalance = calculatePlayersBalance(
      apuration.total_deposits,
      apuration.total_withdrawals,
      apuration.total_bets,
      apuration.total_prizes,
    );
    const bankAccounts = await this.prisma.bankAccount.findMany({
      where: { company_id: brand.company_id, metadeleted: false, is_active: true },
    });
    const totalBankBalance = bankAccounts.reduce((s, a) => s + a.current_balance, 0n);
    const segregation = checkSegregation(expectedPlayersBalance, totalBankBalance);

    return serializeBigInt({
      apuration,
      daily_records: dailyRecords,
      segregation,
    });
  }

  /**
   * Fecha a apuração mensal e gera as contas a pagar dos impostos.
   */
  async closeApuration(brandId: string, year: number, month: number, dto: CloseApurationDto, current: any) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || brand.metadeleted) throw new BadRequestException('Marca inválida.');
    assertTenantAccess(brand, current);

    // Recalcula primeiro
    await this.getMonthlyApuration(brandId, year, month, current);

    const apuration = await this.prisma.ggrMonthlyApuration.findUnique({
      where: { brand_id_year_month: { brand_id: brandId, year, month } },
    });
    if (!apuration) throw new NotFoundException('Apuração não encontrada.');
    if (apuration.status !== GgrApurationStatus.OPEN) {
      throw new BadRequestException('Apuração já está fechada.');
    }

    // Gera contas a pagar dos impostos
    const dueDate = new Date(Date.UTC(year, month, 20)); // dia 20 do mês seguinte
    const monthStr = `${String(month).padStart(2, '0')}/${year}`;

    const generated: any[] = [];

    if (apuration.tax_lei14790_amount > 0n) {
      const p = await this.prisma.accountPayable.create({
        data: {
          description: `Imposto Lei 14.790 (12%) - ${brand.name} - ${monthStr}`,
          supplier_name: 'Receita Federal',
          amount: apuration.tax_lei14790_amount,
          issue_date: new Date(),
          due_date: dueDate,
          company_id: brand.company_id,
          brand_id: brand.id,
          ggr_apuration_id: apuration.id,
          notes: `Apuração GGR ${monthStr} - 12% sobre receita líquida`,
        },
      });
      generated.push(p);
    }

    if (apuration.irrf_amount > 0n) {
      const p = await this.prisma.accountPayable.create({
        data: {
          description: `IRRF Prêmios (15%) - ${brand.name} - ${monthStr}`,
          supplier_name: 'Receita Federal',
          amount: apuration.irrf_amount,
          issue_date: new Date(),
          due_date: dueDate,
          company_id: brand.company_id,
          brand_id: brand.id,
          ggr_apuration_id: apuration.id,
          notes: `Apuração GGR ${monthStr} - IRRF 15% sobre prêmios tributáveis`,
        },
      });
      generated.push(p);
    }

    if (apuration.pis_amount > 0n) {
      const p = await this.prisma.accountPayable.create({
        data: {
          description: `PIS (0,65%) - ${brand.name} - ${monthStr}`,
          supplier_name: 'Receita Federal',
          amount: apuration.pis_amount,
          issue_date: new Date(),
          due_date: dueDate,
          company_id: brand.company_id,
          brand_id: brand.id,
          ggr_apuration_id: apuration.id,
          notes: `Apuração GGR ${monthStr} - PIS sobre receita`,
        },
      });
      generated.push(p);
    }

    if (apuration.cofins_amount > 0n) {
      const p = await this.prisma.accountPayable.create({
        data: {
          description: `COFINS (3%) - ${brand.name} - ${monthStr}`,
          supplier_name: 'Receita Federal',
          amount: apuration.cofins_amount,
          issue_date: new Date(),
          due_date: dueDate,
          company_id: brand.company_id,
          brand_id: brand.id,
          ggr_apuration_id: apuration.id,
          notes: `Apuração GGR ${monthStr} - COFINS sobre receita`,
        },
      });
      generated.push(p);
    }

    const closed = await this.prisma.ggrMonthlyApuration.update({
      where: { id: apuration.id },
      data: {
        status: GgrApurationStatus.CLOSED,
        closed_at: new Date(),
        closed_by_id: current.id,
        notes: dto.notes,
      },
    });

    await this.audit.log('CLOSE', 'GGR_APURATION', apuration.id, current.id, {
      generated_payables: generated.length,
    });

    await this.safePostGgrApurationTaxes(apuration.id);

    return serializeBigInt({
      apuration: closed,
      generated_payables: generated,
    });
  }

  /**
   * Reabre uma apuração (cancela os pagamentos gerados).
   */
  async reopenApuration(brandId: string, year: number, month: number, current: any) {
    const apuration = await this.prisma.ggrMonthlyApuration.findUnique({
      where: { brand_id_year_month: { brand_id: brandId, year, month } },
    });
    if (!apuration) throw new NotFoundException('Apuração não encontrada.');
    assertTenantAccess(apuration, current);
    if (apuration.status === GgrApurationStatus.PAID) {
      throw new BadRequestException('Apuração já paga não pode ser reaberta.');
    }

    // Cancela contas a pagar geradas que ainda estejam pendentes
    await this.prisma.accountPayable.updateMany({
      where: { ggr_apuration_id: apuration.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELLED },
    });

    const reopened = await this.prisma.ggrMonthlyApuration.update({
      where: { id: apuration.id },
      data: { status: GgrApurationStatus.OPEN, closed_at: null, closed_by_id: null },
    });

    await this.audit.log('REOPEN', 'GGR_APURATION', apuration.id, current.id);
    return serializeBigInt(reopened);
  }

  /**
   * Dashboard com indicadores principais do mês corrente.
   */
  async getDashboard(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    where.metadeleted = false;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const today = new Date();
    const year = parseInt(filters.year ?? today.getFullYear());
    const month = parseInt(filters.month ?? (today.getMonth() + 1));

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    // Dados do mês corrente
    const monthRecords = await this.prisma.ggrDailyRecord.findMany({
      where: { ...where, date: { gte: monthStart, lt: monthEnd } },
    });
    const monthTotals = monthRecords.reduce(
      (acc, r) => ({
        bets: acc.bets + r.total_bets,
        prizes: acc.prizes + r.total_prizes,
        deposits: acc.deposits + r.total_deposits,
        withdrawals: acc.withdrawals + r.total_withdrawals,
      }),
      { bets: 0n, prizes: 0n, deposits: 0n, withdrawals: 0n },
    );
    const monthGgr = monthTotals.bets - monthTotals.prizes;
    const monthTaxes = calculateTaxes(monthTotals.bets, monthTotals.prizes);

    // GGR ano-a-data
    const yearRecords = await this.prisma.ggrDailyRecord.findMany({
      where: { ...where, date: { gte: yearStart, lt: yearEnd } },
    });
    const yearTotals = yearRecords.reduce(
      (acc, r) => ({
        bets: acc.bets + r.total_bets,
        prizes: acc.prizes + r.total_prizes,
        deposits: acc.deposits + r.total_deposits,
        withdrawals: acc.withdrawals + r.total_withdrawals,
      }),
      { bets: 0n, prizes: 0n, deposits: 0n, withdrawals: 0n },
    );
    const yearGgr = yearTotals.bets - yearTotals.prizes;
    const yearTaxes = calculateTaxes(yearTotals.bets, yearTotals.prizes);

    // Série mensal do ano (12 meses)
    const monthlySeries: Array<any> = [];
    for (let m = 1; m <= 12; m++) {
      const mStart = new Date(Date.UTC(year, m - 1, 1));
      const mEnd = new Date(Date.UTC(year, m, 1));
      const recs = yearRecords.filter(r => r.date >= mStart && r.date < mEnd);
      const totals = recs.reduce(
        (acc, r) => ({
          bets: acc.bets + r.total_bets,
          prizes: acc.prizes + r.total_prizes,
        }),
        { bets: 0n, prizes: 0n },
      );
      monthlySeries.push({
        month: m,
        bets: totals.bets.toString(),
        prizes: totals.prizes.toString(),
        ggr: (totals.bets - totals.prizes).toString(),
      });
    }

    return serializeBigInt({
      year,
      month,
      current_month: {
        ...monthTotals,
        ggr: monthGgr,
        taxes: monthTaxes,
      },
      year_to_date: {
        ...yearTotals,
        ggr: yearGgr,
        taxes: yearTaxes,
      },
      monthly_series: monthlySeries,
    });
  }

  /**
   * Lista todas as apurações (para visão de admin/manager).
   */
  async listApurations(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    where.metadeleted = false;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.year) where.year = parseInt(filters.year);
    if (filters.status) where.status = filters.status;

    const data = await this.prisma.ggrMonthlyApuration.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { brand: { select: { id: true, name: true } } },
      take: 100,
    });
    return serializeBigInt({ data, total: data.length });
  }
}

@ApiTags('ggr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('ggr')
export class GgrController {
  constructor(private service: GgrService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('import')
  importFile(@Body() dto: ImportGgrDto, @CurrentUser() user: any) {
    return this.service.importFile(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('manual')
  createManual(@Body() dto: ManualGgrDto, @CurrentUser() user: any) {
    return this.service.createManual(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('daily')
  findDaily(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findDaily(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch('daily/:id')
  updateDaily(@Param('id') id: string, @Body() dto: Partial<ManualGgrDto>, @CurrentUser() user: any) {
    return this.service.updateDaily(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete('daily/:id')
  deleteDaily(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteDaily(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete('apurations/:id')
  deleteApuration(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteApuration(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('monthly/:brandId/:year/:month')
  getMonthly(@Param('brandId') brandId: string, @Param('year') year: string, @Param('month') month: string, @CurrentUser() user: any) {
    return this.service.getMonthlyApuration(brandId, parseInt(year), parseInt(month), user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('monthly/:brandId/:year/:month/close')
  closeMonthly(@Param('brandId') brandId: string, @Param('year') year: string, @Param('month') month: string, @Body() dto: CloseApurationDto, @CurrentUser() user: any) {
    return this.service.closeApuration(brandId, parseInt(year), parseInt(month), dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('monthly/:brandId/:year/:month/reopen')
  reopenMonthly(@Param('brandId') brandId: string, @Param('year') year: string, @Param('month') month: string, @CurrentUser() user: any) {
    return this.service.reopenApuration(brandId, parseInt(year), parseInt(month), user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('apurations')
  listApurations(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listApurations(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('dashboard')
  getDashboard(@Query() q: any, @CurrentUser() user: any) {
    return this.service.getDashboard(q, user);
  }

  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contbet_ggr_template.csv"')
  downloadTemplate(@Res() res: Response) {
    const csv = generateGgrTemplateCSV();
    res.send('\ufeff' + csv); // BOM para UTF-8 abrir certo no Excel
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [GgrController],
  providers: [GgrService],
  exports: [GgrService],
})
export class GgrModule {}
