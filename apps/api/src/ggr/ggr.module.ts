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
import { parseGgrFile, generateGgrTemplateCSV, generateGgrTemplateXLSX } from './ggr-parser';
import { calculateTaxes, calculatePlayersBalance, checkSegregation } from './tax-calculator';
import { calculateDarfBreakdown, calculateAllDestinations, CATEGORY_LABELS, CATEGORY_DESCRIPTIONS } from './darf-destinations';
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
  @IsOptional() @IsNumber() @Min(0) total_bonus?: number;
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

  /** Helper público para o controller obter o nome de uma marca. */
  async getBrandName(brandId: string): Promise<string | undefined> {
    const b = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });
    return b?.name;
  }

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
    assertTenantAccess(brand, current, { allowOwner: true, ownerScope: 'brand' });

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
        total_bonus: line.total_bonus ?? 0n,
        total_cashback: line.total_cashback ?? 0n,
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
    assertTenantAccess(brand, current, { allowOwner: true, ownerScope: 'brand' });

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
      total_bonus: BigInt(dto.total_bonus ?? 0),
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
    const where = buildTenantWhere(current, {}, { allowOwner: true, ownerScope: 'brand' });
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
    assertTenantAccess(record, current, { allowOwner: true, ownerScope: 'brand' });
    await this.prisma.ggrDailyRecord.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'GGR_DAILY', id, current.id);
    // Remove lançamento contábil correspondente.
    await this.safePostGgr(id);
    return { ok: true };
  }

  async updateDaily(id: string, dto: Partial<ManualGgrDto>, current: any) {
    const record = await this.prisma.ggrDailyRecord.findUnique({ where: { id } });
    if (!record || record.metadeleted) throw new NotFoundException('Registro não encontrado.');
    assertTenantAccess(record, current, { allowOwner: true, ownerScope: 'brand' });

    const data: any = {};
    if (dto.total_bets !== undefined) data.total_bets = BigInt(dto.total_bets);
    if (dto.total_prizes !== undefined) data.total_prizes = BigInt(dto.total_prizes);
    if (dto.total_deposits !== undefined) data.total_deposits = BigInt(dto.total_deposits);
    if (dto.total_withdrawals !== undefined) data.total_withdrawals = BigInt(dto.total_withdrawals);
    if (dto.total_bonus !== undefined) data.total_bonus = BigInt(dto.total_bonus);
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
    assertTenantAccess(a, current, { allowOwner: true, ownerScope: 'brand' });
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
    assertTenantAccess(brand, current, { allowOwner: true, ownerScope: 'brand' });

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
          total_bonus: acc.total_bonus + (r.total_bonus ?? 0n),
          total_cashback: acc.total_cashback + (r.total_cashback ?? 0n),
        }),
        { total_bets: 0n, total_prizes: 0n, total_deposits: 0n, total_withdrawals: 0n, total_bonus: 0n, total_cashback: 0n },
      );

      // Carrega configuração tributária da empresa para usar as alíquotas reais
      // do regime configurado (NAO_CUMULATIVO 1,65/7,60 ou CUMULATIVO 0,65/3,00).
      const cfg = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: brand.company_id } });
      const pis_rate = cfg ? Number(cfg.pis_rate) : 0.65;
      const cofins_rate = cfg ? Number(cfg.cofins_rate) : 3.0;

      // Aplica metodologia escolhida pela empresa para o GGR-base do imposto Lei 14.790.
      // OFFICIAL                : ggr_base = apostas - prêmios
      // DEDUCT_CASHBACK         : ggr_base = apostas - prêmios - cashback
      // DEDUCT_BONUS_CASHBACK   : ggr_base = apostas - prêmios - bônus - cashback
      // Quando a metodologia exige termo, exige-se que ele esteja assinado.
      const methodology = cfg?.ggr_methodology ?? 'OFFICIAL';
      if (methodology !== 'OFFICIAL' && !cfg?.ggr_term_signed_at) {
        throw new BadRequestException(
          'Metodologia GGR com abatimento exige termo de responsabilidade assinado. Faça upload em Configuração tributária.',
        );
      }
      const ggrOfficial = totals.total_bets - totals.total_prizes;
      let ggrAdjusted = ggrOfficial;
      if (methodology === 'DEDUCT_CASHBACK') ggrAdjusted = ggrOfficial - totals.total_cashback;
      else if (methodology === 'DEDUCT_BONUS_CASHBACK') ggrAdjusted = ggrOfficial - totals.total_bonus - totals.total_cashback;
      if (ggrAdjusted < 0n) ggrAdjusted = 0n;

      const taxes = calculateTaxes(totals.total_bets, totals.total_prizes, { pis_rate, cofins_rate });

      // Sobrescreve GGR e imposto Lei 14.790 com a metodologia escolhida.
      // Os outros (PIS/COFINS/IRRF) seguem cálculo padrão sobre GGR oficial.
      const tax14790Adjusted = (ggrAdjusted * BigInt(Math.round(Number(taxes.tax_lei14790_rate ?? 13) * 100))) / 10000n;

      const apurationData: any = {
        year,
        month,
        total_bets: totals.total_bets,
        total_prizes: totals.total_prizes,
        total_deposits: totals.total_deposits,
        total_withdrawals: totals.total_withdrawals,
        total_bonus: totals.total_bonus,
        total_cashback: totals.total_cashback,
        ggr: ggrAdjusted,
        net_revenue: ggrAdjusted - tax14790Adjusted,
        ggr_methodology: methodology,
        ggr_term_snapshot_url: cfg?.ggr_term_pdf_url ?? null,
        ggr_term_snapshot_signed: cfg?.ggr_term_signed_at ?? null,
        tax_lei14790_amount: tax14790Adjusted,
        irrf_taxable_base: taxes.irrf_taxable_base,
        irrf_amount: taxes.irrf_amount,
        pis_rate: taxes.pis_rate,
        pis_amount: taxes.pis_amount,
        cofins_rate: taxes.cofins_rate,
        cofins_amount: taxes.cofins_amount,
        pis_cofins_regime: cfg?.pis_cofins_regime ?? undefined,
        // total_taxes do GGR considera SÓ os tributos exclusivos da operação de apostas
        // (Lei 14.790 + IRRF). PIS/COFINS são apurados separadamente em /tax/apurations
        // e ficam armazenados nos campos individuais para auditoria.
        total_taxes: tax14790Adjusted + taxes.irrf_amount,
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
    assertTenantAccess(brand, current, { allowOwner: true, ownerScope: 'brand' });

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
          description: `Imposto Lei 14.790 (13%) - ${brand.name} - ${monthStr}`,
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

    // IRRF: removido. Casas de apostas não retêm IRRF dos prêmios — apenas
    // informam os ganhos dos apostadores à Receita Federal.

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
    assertTenantAccess(apuration, current, { allowOwner: true, ownerScope: 'brand' });
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
    const where = buildTenantWhere(current, {}, { allowOwner: true, ownerScope: 'brand' });
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
    const where = buildTenantWhere(current, {}, { allowOwner: true, ownerScope: 'brand' });
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

  /**
   * Calcula a apuração mensal de TODAS as marcas de uma empresa em uma única
   * operação. Usado no atalho "Calcular todas" da tela de Apurações.
   * Retorna um resumo do que foi calculado/atualizado e quais marcas falharam.
   */
  async calculateAllForCompany(companyId: string, year: number, month: number, current: any) {
    if (!companyId) throw new BadRequestException('Empresa obrigatória.');
    if (month < 1 || month > 12) throw new BadRequestException('Mês inválido.');

    if (current.profile === Profile.MANAGER && current.company_id !== companyId) {
      throw new ForbiddenException('Sem acesso a esta empresa.');
    }

    const brandWhere: any = { company_id: companyId, metadeleted: false };
    if (current.profile === Profile.OWNER) {
      const allowed = (current.brand_ids && current.brand_ids.length > 0)
        ? current.brand_ids
        : (current.brand_id ? [current.brand_id] : []);
      brandWhere.id = allowed.length === 0 ? '__none__' : { in: allowed };
    }
    const brands = await this.prisma.brand.findMany({
      where: brandWhere,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    const results: Array<{ brand_id: string; brand_name: string; ok: boolean; ggr?: string; total_taxes?: string; error?: string }> = [];
    for (const b of brands) {
      try {
        const r: any = await this.getMonthlyApuration(b.id, year, month, current);
        const ap = r?.apuration ?? r;
        results.push({
          brand_id: b.id,
          brand_name: b.name,
          ok: true,
          ggr: String(ap.ggr ?? '0'),
          total_taxes: String(ap.total_taxes ?? '0'),
        });
      } catch (err: any) {
        results.push({
          brand_id: b.id,
          brand_name: b.name,
          ok: false,
          error: err?.message ?? 'Falha no cálculo',
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const totalGgr = results
      .filter((r) => r.ok)
      .reduce((acc, r) => acc + BigInt(r.ggr ?? '0'), 0n);
    const totalTaxes = results
      .filter((r) => r.ok)
      .reduce((acc, r) => acc + BigInt(r.total_taxes ?? '0'), 0n);

    await this.audit.log('CALCULATE_ALL', 'GGR', undefined, current.id, {
      company_id: companyId, year, month, brands: brands.length, ok: okCount,
    });

    return serializeBigInt({
      company_id: companyId,
      year, month,
      brands_total: brands.length,
      brands_ok: okCount,
      brands_failed: brands.length - okCount,
      total_ggr: totalGgr,
      total_taxes: totalTaxes,
      results,
    });
  }

  /**
   * Relatório consolidado de apuração GGR para um mês/empresa.
   * - Lista TODAS as marcas da empresa com apuração no período (se não houver,
   *   chama getMonthlyApuration internamente para criar/recalcular)
   * - Calcula totais consolidados (GGR, depósitos, saques, impostos)
   * - Inclui metadados da empresa e metodologia aplicada
   *
   * Usado pela tela /dashboard/ggr/report e pelo export Excel.
   */
  async getApurationReport(companyId: string, year: number, month: number, current: any, brandId?: string) {
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

    // Lista todas as marcas da empresa
    const brandWhere: any = { company_id: companyId, metadeleted: false };
    if (current.profile === Profile.OWNER) {
      const allowed = (current.brand_ids && current.brand_ids.length > 0)
        ? current.brand_ids
        : (current.brand_id ? [current.brand_id] : []);
      brandWhere.id = allowed.length === 0 ? '__none__' : { in: allowed };
    }
    let brands = await this.prisma.brand.findMany({ where: brandWhere, orderBy: { name: 'asc' } });
    // Filtro adicional por marca específica (relatório individual para gestor de marca)
    if (brandId) brands = brands.filter(b => b.id === brandId);

    // Para cada marca, garante que existe apuração — chama getMonthlyApuration
    // (que recalcula se OPEN ou cria se não existe). Em caso de erro (ex.: termo
    // não assinado), captura e marca como "erro" no resultado.
    // Nota: getMonthlyApuration retorna { apuration: {...}, daily_records: [...] };
    // aqui achatamos para a apuration vir no nível raiz, com brand já incluído.
    const apurations: any[] = [];
    for (const b of brands) {
      try {
        const result: any = await this.getMonthlyApuration(b.id, year, month, current);
        const ap = result?.apuration ?? result;
        apurations.push({ ...ap, _error: null });
      } catch (err: any) {
        apurations.push({
          brand_id: b.id,
          brand: { id: b.id, name: b.name },
          year, month,
          _error: err?.message ?? 'Falha no cálculo',
          _has_data: false,
        });
      }
    }

    // Consolidação dos totais (apenas marcas com sucesso)
    const valid = apurations.filter((a) => !a._error);
    const sum = (k: string) => valid.reduce((acc, a) => acc + (BigInt(a[k] ?? 0)), 0n);

    const totals = {
      brands_count: brands.length,
      brands_with_data: valid.length,
      brands_with_error: apurations.length - valid.length,
      total_bets:           sum('total_bets'),
      total_prizes:         sum('total_prizes'),
      total_deposits:       sum('total_deposits'),
      total_withdrawals:    sum('total_withdrawals'),
      total_bonus:          sum('total_bonus'),
      total_cashback:       sum('total_cashback'),
      ggr:                  sum('ggr'),
      net_revenue:          sum('net_revenue'),
      tax_lei14790_amount:  sum('tax_lei14790_amount'),
      pis_amount:           sum('pis_amount'),
      cofins_amount:        sum('cofins_amount'),
      irrf_amount:          sum('irrf_amount'),
      total_taxes:          sum('total_taxes'),
    };

    // Desdobramento completo das destinações do art. 30 §1º-A da Lei 13.756/2018
    // (com Lei 14.790/2023 + LC 224/2025 + MP 1.348/2026), distribuídas em
    // 4 categorias: Conta Única do Tesouro (DARF), Entidades privadas,
    // Educação e Direitos de imagem. FUNAPOL caput tratado à parte.
    // Manual SPA/MF (08/05/2026) + Portaria SPA/MF 1.287/2026.
    const destinations_breakdown = calculateAllDestinations(totals.ggr, year, month);
    // Mantém o `darf_breakdown` por compatibilidade com seções/exports que ainda
    // consomem só a parte DARF.
    const darf_breakdown = calculateDarfBreakdown(totals.ggr, year, month);

    return serializeBigInt({
      company,
      tax_config: taxConfig ? {
        tax_regime: taxConfig.tax_regime,
        ggr_methodology: taxConfig.ggr_methodology,
        ggr_term_signed_at: taxConfig.ggr_term_signed_at,
        ggr_term_signed_by_name: taxConfig.ggr_term_signed_by_name,
      } : null,
      year, month,
      brands_apurations: apurations,
      totals,
      destinations_breakdown,
      destinations_metadata: {
        category_labels: CATEGORY_LABELS,
        category_descriptions: CATEGORY_DESCRIPTIONS,
      },
      darf_breakdown,
      generated_at: new Date(),
    });
  }

  /** Exporta o relatório consolidado em PDF — visual pronto para envio ao cliente. */
  async exportApurationReportPdf(companyId: string, year: number, month: number, current: any, brandId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const report: any = await this.getApurationReport(companyId, year, month, current, brandId);
    const PDFDocument = require('pdfkit');
    const monthNamesPt = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fmtBRL = (v: any) => v == null ? '—' : 'R$ ' + (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';
    const methodLabels: Record<string, string> = {
      OFFICIAL: 'Oficial SPA/MF (apostas − prêmios)',
      DEDUCT_CASHBACK: 'Abatendo Cashback',
      DEDUCT_BONUS_CASHBACK: 'Abatendo Bônus e Cashback',
    };

    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    // Cabeçalho
    doc.fillColor('#1c1917').fontSize(8).font('Helvetica').text('APURAÇÃO GGR — LEI 14.790/2023', { align: 'left' });
    doc.fontSize(20).font('Helvetica-Bold').text(`${monthNamesPt[month]} / ${year}`, { align: 'left' });
    doc.moveUp(2);

    // Empresa (à direita)
    doc.font('Helvetica-Bold').fontSize(11).text(report.company.name, { align: 'right' });
    doc.font('Helvetica').fontSize(9);
    doc.text(`CNPJ ${fmtCnpj(report.company.cnpj || '')}`, { align: 'right' });
    doc.text(`${[report.company.city, report.company.state].filter(Boolean).join('/')}`, { align: 'right' });
    doc.moveDown(0.5);

    // Linha separadora
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
    drawBadge(`Regime: ${report.company.tax_regime ?? '—'}`, '#44403c');
    if (report.tax_config) {
      const m = report.tax_config.ggr_methodology;
      const color = m === 'OFFICIAL' ? '#15803d' : m === 'DEDUCT_CASHBACK' ? '#a16207' : '#b91c1c';
      drawBadge(methodLabels[m] ?? m, color);
    }
    if (report.tax_config?.ggr_term_signed_at) drawBadge('Termo assinado', '#15803d');
    doc.fillColor('#1c1917');
    doc.y = badgeY + 22;

    // Cards de totais (4 colunas)
    const cardY = doc.y;
    const cardW = 180; const cardGap = 8;
    const cards = [
      { label: 'GGR APLICADO', value: fmtBRL(report.totals.ggr), color: '#a16207' },
      { label: 'TOTAL DE IMPOSTOS', value: fmtBRL(report.totals.total_taxes), color: '#b91c1c' },
      { label: 'APOSTAS BRUTAS', value: fmtBRL(report.totals.total_bets), color: '#1c1917' },
      { label: 'PRÊMIOS PAGOS', value: fmtBRL(report.totals.total_prizes), color: '#1c1917' },
    ];
    cards.forEach((c, i) => {
      const x = 40 + i * (cardW + cardGap);
      doc.roundedRect(x, cardY, cardW, 50, 2).fillAndStroke('#fafaf9', '#e7e5e4');
      doc.fillColor('#78716c').fontSize(7).font('Helvetica').text(c.label, x + 8, cardY + 7);
      doc.fillColor(c.color).fontSize(14).font('Helvetica-Bold').text(c.value, x + 8, cardY + 22, { width: cardW - 16 });
    });
    doc.y = cardY + 60;
    doc.fillColor('#1c1917');

    // Tabela por marca
    doc.fontSize(11).font('Helvetica-Bold').text('Detalhamento por marca', 40, doc.y);
    doc.moveDown(0.3);

    const tblTop = doc.y;
    const cols = [
      { label: 'Marca',           x: 40,  w: 140, align: 'left'  as const },
      { label: 'Apostas',         x: 180, w: 95,  align: 'right' as const },
      { label: 'Prêmios',         x: 275, w: 95,  align: 'right' as const },
      { label: 'GGR',             x: 370, w: 95,  align: 'right' as const },
      { label: 'Bônus',           x: 465, w: 70,  align: 'right' as const },
      { label: 'Cashback',        x: 535, w: 70,  align: 'right' as const },
      { label: 'Lei 14.790',      x: 605, w: 90,  align: 'right' as const },
      { label: 'Total Imp.',      x: 695, w: 100, align: 'right' as const },
    ];

    // Header
    doc.rect(40, tblTop, 755, 18).fill('#f5f5f4');
    doc.fillColor('#44403c').fontSize(8).font('Helvetica-Bold');
    cols.forEach(c => doc.text(c.label, c.x + 4, tblTop + 5, { width: c.w - 8, align: c.align }));
    doc.fillColor('#1c1917');
    let rowY = tblTop + 18;

    // Rows
    doc.font('Helvetica').fontSize(8);
    for (const a of report.brands_apurations) {
      doc.rect(40, rowY, 755, 18).fillAndStroke('#ffffff', '#e7e5e4');
      doc.fillColor('#1c1917');
      if (a._error) {
        doc.text(a.brand?.name ?? '—', cols[0].x + 4, rowY + 5, { width: cols[0].w });
        doc.fillColor('#b91c1c').text(`⚠ ${a._error}`, cols[1].x + 4, rowY + 5, { width: 615 });
        doc.fillColor('#1c1917');
      } else {
        const values = [
          a.brand?.name ?? '—',
          fmtBRL(a.total_bets),
          fmtBRL(a.total_prizes),
          fmtBRL(a.ggr),
          fmtBRL(a.total_bonus),
          fmtBRL(a.total_cashback),
          fmtBRL(a.tax_lei14790_amount),
          fmtBRL(a.total_taxes),
        ];
        cols.forEach((c, i) => doc.text(values[i], c.x + 4, rowY + 5, { width: c.w - 8, align: c.align }));
      }
      rowY += 18;
    }

    // Total row
    doc.rect(40, rowY, 755, 20).fillAndStroke('#f5f5f4', '#a8a29e');
    doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL', cols[0].x + 4, rowY + 6, { width: cols[0].w });
    const totalValues = [
      fmtBRL(report.totals.total_bets),
      fmtBRL(report.totals.total_prizes),
      fmtBRL(report.totals.ggr),
      fmtBRL(report.totals.total_bonus),
      fmtBRL(report.totals.total_cashback),
      fmtBRL(report.totals.tax_lei14790_amount),
      fmtBRL(report.totals.total_taxes),
    ];
    cols.slice(1).forEach((c, i) => doc.text(totalValues[i], c.x + 4, rowY + 6, { width: c.w - 8, align: c.align }));
    rowY += 28;

    // Detalhamento tributário e movimentação (lado a lado)
    doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(11).text('Tributos do GGR (Lei 14.790)', 40, rowY);
    doc.text('Movimentação de jogadores', 420, rowY);
    rowY += 16;

    // Apenas tributos exclusivos do GGR. PIS/COFINS são apurados separadamente.
    const taxRows = [
      ['Imposto Lei 14.790 (13% s/ GGR)', fmtBRL(report.totals.tax_lei14790_amount)],
      ['IRRF (sobre prêmios)', fmtBRL(report.totals.irrf_amount)],
    ];
    const playerRows = [
      ['Depósitos', fmtBRL(report.totals.total_deposits)],
      ['Saques', fmtBRL(report.totals.total_withdrawals)],
      ['Saldo retido', fmtBRL(BigInt(report.totals.total_deposits) - BigInt(report.totals.total_withdrawals))],
    ];

    doc.font('Helvetica').fontSize(9);
    const startY = rowY;
    taxRows.forEach((r, i) => {
      const y = startY + i * 16;
      doc.fillColor('#44403c').text(r[0], 40, y, { width: 200 });
      doc.fillColor('#1c1917').font('Helvetica-Bold').text(r[1], 240, y, { width: 130, align: 'right' });
      doc.font('Helvetica');
    });
    playerRows.forEach((r, i) => {
      const y = startY + i * 16;
      doc.fillColor('#44403c').text(r[0], 420, y, { width: 200 });
      doc.fillColor('#1c1917').font('Helvetica-Bold').text(r[1], 620, y, { width: 175, align: 'right' });
      doc.font('Helvetica');
    });

    // Footer
    const footY = 555;
    doc.moveTo(40, footY).lineTo(802, footY).strokeColor('#e7e5e4').stroke();
    doc.fontSize(7).fillColor('#78716c');
    doc.text(`Gerado em ${new Date(report.generated_at).toLocaleString('pt-BR')}`, 40, footY + 5);
    if (report.tax_config?.ggr_term_signed_at) {
      doc.text(
        `Termo assinado por ${report.tax_config.ggr_term_signed_by_name} em ${new Date(report.tax_config.ggr_term_signed_at).toLocaleDateString('pt-BR')}`,
        40, footY + 5,
        { align: 'right' },
      );
    }

    // ===== Páginas adicionais: Destinações da Lei 14.790 (manual SPA/MF 08/05/2026) =====
    if (report.destinations_breakdown && Number(report.destinations_breakdown.total_recolhimento_centavos) > 0) {
      const dest = report.destinations_breakdown;
      const labels = report.destinations_metadata?.category_labels ?? {};
      const descriptions = report.destinations_metadata?.category_descriptions ?? {};
      const fmtPct = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

      doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });

      // Cabeçalho
      doc.fillColor('#1c1917').fontSize(8).font('Helvetica').text('DESTINAÇÕES DA LEI 14.790 — REPASSES DIRETOS', 40, 40);
      doc.fontSize(16).font('Helvetica-Bold').text(`Manual SPA/MF (08/05/2026) · ${monthNamesPt[month]}/${year}`, 40);
      doc.font('Helvetica').fontSize(8).fillColor('#78716c').text('Lei 13.756/2018 art. 30 §1º-A · Portarias SPA/MF 1.287/2026, 41/2025 · Portaria MEC 1.240/2024', 40);
      doc.fillColor('#1c1917');
      doc.moveDown(0.6);

      // Card de total
      const totY = doc.y;
      doc.roundedRect(40, totY, 755, 44, 2).fillAndStroke('#fafaf9', '#e7e5e4');
      doc.fillColor('#78716c').fontSize(8).font('Helvetica').text(`TOTAL A RECOLHER (${fmtPct(dest.effective_total_rate_pct)}% do GGR)`, 50, totY + 7);
      doc.fillColor('#1c1917').fontSize(18).font('Helvetica-Bold').text(fmtBRL(dest.total_recolhimento_centavos), 50, totY + 18);
      doc.font('Helvetica').fontSize(7).fillColor('#78716c')
        .text(`GGR base: ${fmtBRL(dest.ggr_centavos)}`, 50, totY + 22, { width: 745, align: 'right' })
        .text(`12% destinações: ${fmtBRL(dest.total_destinacoes_12pct_centavos)}${dest.funapol_caput ? ` + FUNAPOL caput ${fmtPct(dest.funapol_caput.rate_on_ggr)}% (${fmtBRL(dest.funapol_caput.valor_centavos)})` : ''}`, 50, totY + 33, { width: 745, align: 'right' });
      doc.fillColor('#1c1917');
      doc.y = totY + 54;

      // Resumo das 4 categorias em cards
      const catOrder: Array<'CONTA_UNICA_TESOURO' | 'ENTIDADE_PRIVADA' | 'EDUCACAO' | 'IMAGEM_PROP_INTELECTUAL'> = [
        'CONTA_UNICA_TESOURO', 'ENTIDADE_PRIVADA', 'EDUCACAO', 'IMAGEM_PROP_INTELECTUAL',
      ];
      const catColors: Record<string, { fill: string; stroke: string; text: string }> = {
        CONTA_UNICA_TESOURO: { fill: '#eff6ff', stroke: '#bfdbfe', text: '#1e3a8a' },
        ENTIDADE_PRIVADA:    { fill: '#f5f3ff', stroke: '#ddd6fe', text: '#5b21b6' },
        EDUCACAO:            { fill: '#ecfdf5', stroke: '#a7f3d0', text: '#065f46' },
        IMAGEM_PROP_INTELECTUAL: { fill: '#fffbeb', stroke: '#fde68a', text: '#92400e' },
      };

      const summaryY = doc.y;
      const cardW = 180; const cardGap = 8;
      catOrder.forEach((cat, i) => {
        const c = dest.categories.find((x: any) => x.category === cat);
        if (!c) return;
        const x = 40 + i * (cardW + cardGap);
        const col = catColors[cat];
        doc.roundedRect(x, summaryY, cardW, 50, 2).fillAndStroke(col.fill, col.stroke);
        doc.fillColor(col.text).fontSize(7).font('Helvetica-Bold').text(labels[cat] ?? cat, x + 8, summaryY + 7, { width: cardW - 16 });
        doc.fillColor('#1c1917').fontSize(13).font('Helvetica-Bold').text(fmtBRL(c.total_centavos), x + 8, summaryY + 25, { width: cardW - 16 });
      });
      doc.y = summaryY + 60;
      doc.fillColor('#1c1917');

      // Para cada categoria com beneficiários: tabela
      for (const cat of catOrder) {
        const c = dest.categories.find((x: any) => x.category === cat);
        if (!c || c.beneficiaries.length === 0) continue;

        const linhasNecessarias = 32 + (c.beneficiaries.length * 14) + 16;
        if (doc.y + linhasNecessarias > 540) {
          doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });
          doc.fillColor('#1c1917').fontSize(10).font('Helvetica-Bold').text(`Destinações da Lei 14.790 (continuação) · ${monthNamesPt[month]}/${year}`, 40, 40);
          doc.moveDown(0.5);
        }

        const col = catColors[cat];
        const sumPct = c.beneficiaries.reduce((s: number, b: any) => s + b.effective_rate_on_ggr, 0);

        // Cabeçalho da categoria
        const headY = doc.y;
        doc.roundedRect(40, headY, 755, 28, 2).fillAndStroke(col.fill, col.stroke);
        doc.fillColor(col.text).fontSize(11).font('Helvetica-Bold').text(labels[cat] ?? cat, 50, headY + 7, { width: 600 });
        doc.font('Helvetica').fontSize(7).fillColor('#78716c').text(`${fmtPct(sumPct)}% do GGR`, 50, headY + 18, { width: 600 });
        doc.fillColor('#1c1917').fontSize(13).font('Helvetica-Bold').text(fmtBRL(c.total_centavos), 600, headY + 8, { width: 185, align: 'right' });
        doc.y = headY + 32;

        // Tabela
        const showDarf = cat === 'CONTA_UNICA_TESOURO';
        const benefCols: Array<{ label: string; x: number; w: number; align: 'left' | 'right' }> = showDarf
          ? [
              { label: 'Beneficiário',  x: 40,  w: 230, align: 'left' },
              { label: 'Dispositivo',   x: 270, w: 165, align: 'left' },
              { label: 'DARF',          x: 435, w: 50,  align: 'left' },
              { label: '% Dest.',       x: 485, w: 70,  align: 'right' },
              { label: '% s/ GGR',      x: 555, w: 70,  align: 'right' },
              { label: 'Valor (R$)',    x: 625, w: 170, align: 'right' },
            ]
          : [
              { label: 'Beneficiário',  x: 40,  w: 270, align: 'left' },
              { label: 'Dispositivo',   x: 310, w: 200, align: 'left' },
              { label: '% Dest.',       x: 510, w: 80,  align: 'right' },
              { label: '% s/ GGR',      x: 590, w: 70,  align: 'right' },
              { label: 'Valor (R$)',    x: 660, w: 135, align: 'right' },
            ];

        const tblTop2 = doc.y;
        doc.rect(40, tblTop2, 755, 14).fill('#fafaf9');
        doc.fillColor('#78716c').fontSize(7).font('Helvetica-Bold');
        benefCols.forEach(bc => doc.text(bc.label.toUpperCase(), bc.x + 4, tblTop2 + 4, { width: bc.w - 8, align: bc.align }));
        doc.fillColor('#1c1917');
        let rowY2 = tblTop2 + 14;

        doc.font('Helvetica').fontSize(8);
        for (const b of c.beneficiaries) {
          doc.rect(40, rowY2, 755, 14).strokeColor('#e7e5e4').stroke();
          let i = 0;
          doc.fillColor('#1c1917').text(b.destination.name, benefCols[i].x + 4, rowY2 + 3, { width: benefCols[i].w - 8 }); i++;
          doc.fillColor('#78716c').fontSize(7).text(b.destination.dispositivo, benefCols[i].x + 4, rowY2 + 3, { width: benefCols[i].w - 8 }); i++;
          if (showDarf) {
            doc.fillColor('#1e3a8a').fontSize(7).font('Helvetica-Bold').text(b.destination.darf_code ?? '—', benefCols[i].x + 4, rowY2 + 3, { width: benefCols[i].w - 8 });
            doc.font('Helvetica');
            i++;
          }
          doc.fillColor('#44403c').fontSize(8).text(`${fmtPct(b.destination.percent_of_destinations)}%`, benefCols[i].x + 4, rowY2 + 3, { width: benefCols[i].w - 8, align: 'right' }); i++;
          doc.fillColor('#44403c').fontSize(8).text(`${fmtPct(b.effective_rate_on_ggr)}%`, benefCols[i].x + 4, rowY2 + 3, { width: benefCols[i].w - 8, align: 'right' }); i++;
          doc.fillColor('#1c1917').font('Helvetica-Bold').text(fmtBRL(b.valor_centavos), benefCols[i].x + 4, rowY2 + 3, { width: benefCols[i].w - 8, align: 'right' });
          doc.font('Helvetica');
          rowY2 += 14;
        }
        doc.y = rowY2 + 8;

        // Descrição do método de pagamento
        if (descriptions[cat]) {
          if (doc.y > 525) {
            doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });
            doc.y = 40;
          }
          doc.fontSize(7).fillColor('#78716c').font('Helvetica-Oblique')
            .text(descriptions[cat], 40, doc.y, { width: 755, align: 'justify' });
          doc.fillColor('#1c1917').font('Helvetica');
          doc.moveDown(0.5);
        }
      }

      // FUNAPOL caput, se aplicável
      if (dest.funapol_caput) {
        if (doc.y + 60 > 540) {
          doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });
          doc.y = 40;
        }
        const fcY = doc.y;
        doc.roundedRect(40, fcY, 755, 50, 2).fillAndStroke('#fff1f2', '#fecdd3');
        doc.fillColor('#9f1239').fontSize(10).font('Helvetica-Bold').text(`FUNAPOL — caput escalonado (fora dos 12%) · ${fmtPct(dest.funapol_caput.rate_on_ggr)}% do GGR`, 50, fcY + 7);
        doc.fillColor('#1c1917').fontSize(13).font('Helvetica-Bold').text(fmtBRL(dest.funapol_caput.valor_centavos), 50, fcY + 22, { width: 745 });
        doc.font('Helvetica').fontSize(7).fillColor('#9f1239').text(
          'Art. 30 §1º-A caput · MP 1.348/2026 · Recolhimento DARF 5862. Alíquota: 1% em 2026, 2% em 2027, 3% em 2028. Base: GGR (após dedução dos incisos III e V do art. 30).',
          50, fcY + 38, { width: 745 },
        );
        doc.fillColor('#1c1917');
        doc.y = fcY + 56;
      }

      // Resumo DARF agrupado por código (totais para emissão das guias)
      if (doc.y + 80 > 540) {
        doc.addPage({ size: 'A4', margin: 40, layout: 'landscape' });
        doc.y = 40;
      }
      const darfY = doc.y;
      doc.roundedRect(40, darfY, 755, 18, 2).fillAndStroke('#eff6ff', '#bfdbfe');
      doc.fillColor('#1e3a8a').fontSize(9).font('Helvetica-Bold').text('Recolhimento DARF — totais por código (emissão das guias)', 50, darfY + 5);
      doc.fillColor('#1c1917').font('Helvetica');
      doc.y = darfY + 22;

      const darfCols = [
        { label: 'Código', x: 40,  w: 80,  align: 'left'  as const },
        { label: 'Descrição', x: 120, w: 525, align: 'left'  as const },
        { label: 'Valor (R$)', x: 645, w: 150, align: 'right' as const },
      ];
      doc.rect(40, doc.y, 755, 14).fill('#fafaf9');
      doc.fillColor('#78716c').fontSize(7).font('Helvetica-Bold');
      darfCols.forEach(c => doc.text(c.label.toUpperCase(), c.x + 4, doc.y + 4, { width: c.w - 8, align: c.align }));
      doc.fillColor('#1c1917');
      let dRowY = doc.y + 14;
      doc.font('Helvetica').fontSize(8);
      for (const d of dest.darf_codes) {
        doc.rect(40, dRowY, 755, 14).strokeColor('#e7e5e4').stroke();
        doc.fillColor('#1e3a8a').font('Helvetica-Bold').text(d.codigo + (d.includes_funapol_caput ? ' +caput' : ''), darfCols[0].x + 4, dRowY + 3, { width: darfCols[0].w - 8 });
        doc.fillColor('#44403c').font('Helvetica').fontSize(7).text(d.descricao, darfCols[1].x + 4, dRowY + 3, { width: darfCols[1].w - 8 });
        doc.fillColor('#1c1917').fontSize(8).font('Helvetica-Bold').text(fmtBRL(d.total_centavos), darfCols[2].x + 4, dRowY + 3, { width: darfCols[2].w - 8, align: 'right' });
        doc.font('Helvetica');
        dRowY += 14;
      }
      doc.y = dRowY + 4;

      if (doc.y < 525) {
        doc.fontSize(6.5).fillColor('#78716c').font('Helvetica-Oblique').text(
          'Coluna "% Dest." reproduz o Percentual P do manual (% das Destinações Totais 12%). "% s/ GGR" é a alíquota efetiva = P × 12%. Entidades privadas, Educação e Direitos de imagem são pagas FORA do DARF (transferência bancária ou rateio por competição). A destinação por imagem (7,30% das destinações) tem cálculo em duas fases por competição esportiva conforme regulamento (Portaria SPA/MF 41/2025) — o valor mostrado é o teto agregado.',
          40, doc.y + 2, { width: 755, align: 'justify' },
        );
        doc.fillColor('#1c1917').font('Helvetica');
      }
    }

    doc.end();
    await done;
    const buffer = Buffer.concat(chunks);
    const safeName = (report.company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    const filename = `apuracao-ggr-${safeName}-${String(month).padStart(2, '0')}-${year}.pdf`;
    return { buffer, filename };
  }

  /** Exporta o relatório consolidado em Excel (.xlsx). */
  async exportApurationReportXlsx(companyId: string, year: number, month: number, current: any, brandId?: string): Promise<{ buffer: Buffer; filename: string }> {
    // Permite filtro por marca via parâmetro brand_id
    if (brandId) {
      // delega para getApurationReport que já filtra brands
    }
    const report = await this.getApurationReport(companyId, year, month, current, brandId);
    const XLSX = require('xlsx');

    const monthNames = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fmtBRL = (v: any) => v == null ? '' : (Number(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCnpj = (c: string) => c?.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') ?? '';
    const methodLabels: Record<string, string> = {
      OFFICIAL: 'Oficial SPA/MF (apostas − prêmios)',
      DEDUCT_CASHBACK: 'Abatendo Cashback (apostas − prêmios − cashback)',
      DEDUCT_BONUS_CASHBACK: 'Abatendo Bônus e Cashback (apostas − prêmios − bônus − cashback)',
    };

    // Aba 1: Resumo
    const resumo: any[][] = [
      ['RELATÓRIO DE APURAÇÃO MENSAL DE GGR'],
      [`Período: ${monthNames[month]}/${year}`],
      [''],
      ['DADOS DA EMPRESA'],
      ['Razão Social', report.company.name],
      ['CNPJ', fmtCnpj(report.company.cnpj || '')],
      ['Localização', [report.company.city, report.company.state].filter(Boolean).join('/')],
      ['Regime Tributário', report.company.tax_regime ?? ''],
      ['Metodologia GGR', methodLabels[report.tax_config?.ggr_methodology ?? 'OFFICIAL']],
      ...(report.tax_config?.ggr_term_signed_at
        ? [['Termo de responsabilidade', `Assinado por ${report.tax_config.ggr_term_signed_by_name} em ${new Date(report.tax_config.ggr_term_signed_at).toLocaleDateString('pt-BR')}`]]
        : [['Termo de responsabilidade', '—']]),
      [''],
      ['CONSOLIDADO DA EMPRESA'],
      ['Marcas com apuração', report.totals.brands_with_data],
      ['Apostas brutas (R$)',   fmtBRL(report.totals.total_bets)],
      ['Prêmios pagos (R$)',    fmtBRL(report.totals.total_prizes)],
      ['Bônus distribuído (R$)', fmtBRL(report.totals.total_bonus)],
      ['Cashback distribuído (R$)', fmtBRL(report.totals.total_cashback)],
      ['GGR aplicado (R$)',     fmtBRL(report.totals.ggr)],
      ['Imposto Lei 14.790 (R$)', fmtBRL(report.totals.tax_lei14790_amount)],
      ['IRRF (R$)',             fmtBRL(report.totals.irrf_amount)],
      ['TOTAL IMPOSTOS GGR (R$)', fmtBRL(report.totals.total_taxes)],
      [''],
      ['⚠ PIS e COFINS são apurados separadamente em "Apurações Tributárias"'],
      ['     e não compõem o total de impostos do GGR.'],
      [''],
      ['Movimentação de jogadores'],
      ['Depósitos (R$)',        fmtBRL(report.totals.total_deposits)],
      ['Saques (R$)',           fmtBRL(report.totals.total_withdrawals)],
      ['Saldo retido (R$)',     fmtBRL(BigInt(report.totals.total_deposits) - BigInt(report.totals.total_withdrawals))],
      [''],
      [`Relatório gerado em: ${new Date(report.generated_at).toLocaleString('pt-BR')}`],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(resumo);
    ws1['!cols'] = [{ wch: 30 }, { wch: 50 }];

    // Aba 2: Detalhamento por Marca
    // PIS/COFINS removidos — são apurados separadamente em /tax/apurations
    const detalhe: any[][] = [[
      'Marca', 'Apostas', 'Prêmios', 'GGR aplicado',
      'Bônus', 'Cashback', 'Imposto Lei 14.790', 'IRRF', 'Total Imp. GGR',
      'Depósitos', 'Saques', 'Status',
    ]];
    for (const a of report.brands_apurations) {
      if (a._error) {
        detalhe.push([a.brand?.name ?? '—', `ERRO: ${a._error}`, '', '', '', '', '', '', '', '', '', '']);
      } else {
        detalhe.push([
          a.brand?.name ?? '—',
          fmtBRL(a.total_bets),
          fmtBRL(a.total_prizes),
          fmtBRL(a.ggr),
          fmtBRL(a.total_bonus),
          fmtBRL(a.total_cashback),
          fmtBRL(a.tax_lei14790_amount),
          fmtBRL(a.irrf_amount),
          fmtBRL(a.total_taxes),
          fmtBRL(a.total_deposits),
          fmtBRL(a.total_withdrawals),
          a.status === 'CLOSED' ? 'Fechada' : a.status === 'PAID' ? 'Paga' : 'Aberta',
        ]);
      }
    }
    const ws2 = XLSX.utils.aoa_to_sheet(detalhe);
    ws2['!cols'] = [
      { wch: 25 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 },
      { wch: 16 }, { wch: 16 }, { wch: 12 },
    ];

    // Aba 3: Destinações DARF (Portaria SPA/MF 1.287/2026)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');
    XLSX.utils.book_append_sheet(wb, ws2, 'Por Marca');

    // Aba 3: Destinações da Lei 14.790 (Manual SPA/MF 08/05/2026)
    if (report.destinations_breakdown && Number(report.destinations_breakdown.total_recolhimento_centavos) > 0) {
      const dest = report.destinations_breakdown;
      const labels = report.destinations_metadata?.category_labels ?? {};
      const descriptions = report.destinations_metadata?.category_descriptions ?? {};
      const fmtPct = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

      // Aba consolidada com TODOS os beneficiários (uma linha por beneficiário)
      const all: any[][] = [
        ['DESTINAÇÕES DA LEI 14.790 — MANUAL SPA/MF 08/05/2026'],
        [`Período: ${monthNames[month]}/${year}`],
        ['Lei 13.756/2018 art. 30 §1º-A · Portarias SPA/MF 1.287/2026, 41/2025 · Portaria MEC 1.240/2024'],
        [''],
        ['GGR consolidado (R$)', fmtBRL(dest.ggr_centavos)],
        ['Base de Destinações 12% (R$)', fmtBRL(dest.base_destinacoes_centavos)],
        ['Total destinações 12% (R$)', fmtBRL(dest.total_destinacoes_12pct_centavos)],
        ...(dest.funapol_caput
          ? [[`FUNAPOL caput (${fmtPct(dest.funapol_caput.rate_on_ggr)}% s/ GGR)`, fmtBRL(dest.funapol_caput.valor_centavos)]]
          : []),
        ['TOTAL A RECOLHER (R$)', fmtBRL(dest.total_recolhimento_centavos)],
        ['Alíquota efetiva sobre o GGR', `${fmtPct(dest.effective_total_rate_pct)}%`],
        [''],
        ['Categoria', 'Beneficiário', 'Dispositivo legal', 'DARF', '% Destinações (P)', '% sobre GGR', 'Valor (R$)', 'Forma de pagamento'],
      ];
      const catOrder: Array<'CONTA_UNICA_TESOURO' | 'ENTIDADE_PRIVADA' | 'EDUCACAO' | 'IMAGEM_PROP_INTELECTUAL'> = [
        'CONTA_UNICA_TESOURO', 'ENTIDADE_PRIVADA', 'EDUCACAO', 'IMAGEM_PROP_INTELECTUAL',
      ];
      for (const cat of catOrder) {
        const c = dest.categories.find((x: any) => x.category === cat);
        if (!c || c.beneficiaries.length === 0) continue;
        const catLabel = labels[cat] ?? cat;
        all.push([catLabel, `TOTAL DA CATEGORIA`, '—', '—', '—', '—', fmtBRL(c.total_centavos), '—']);
        for (const b of c.beneficiaries) {
          all.push([
            catLabel,
            b.destination.name,
            b.destination.dispositivo,
            b.destination.darf_code ?? '—',
            `${fmtPct(b.destination.percent_of_destinations)}%`,
            `${fmtPct(b.effective_rate_on_ggr)}%`,
            fmtBRL(b.valor_centavos),
            b.destination.payment_method,
          ]);
        }
        all.push([]);
      }
      if (dest.funapol_caput) {
        all.push(['FUNAPOL caput (fora dos 12%)', `FUNAPOL — ${fmtPct(dest.funapol_caput.rate_on_ggr)}% s/ GGR`, 'Art. 30 §1º-A caput · MP 1.348/2026', '5862', '—', `${fmtPct(dest.funapol_caput.rate_on_ggr)}%`, fmtBRL(dest.funapol_caput.valor_centavos), 'DARF código 5862']);
      }
      all.push([]);
      all.push(['Notas:']);
      all.push(['• Coluna "% Destinações (P)" reproduz o Percentual P do manual (% das Destinações Totais 12%).']);
      all.push(['• Coluna "% sobre GGR" é a alíquota efetiva = P × 12%.']);
      all.push(['• Entidades privadas, Educação e Direitos de imagem são pagas FORA do DARF.']);
      all.push(['• Destinação por imagem (7,30%) tem cálculo em 2 fases por competição (Portaria SPA/MF 41/2025).']);
      const wsAll = XLSX.utils.aoa_to_sheet(all);
      wsAll['!cols'] = [
        { wch: 28 }, { wch: 38 }, { wch: 28 }, { wch: 8 },
        { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 60 },
      ];
      XLSX.utils.book_append_sheet(wb, wsAll, 'Destinações Lei 14.790');

      // Aba 4: Resumo DARF — totais por código (para emissão das guias)
      const darfRows: any[][] = [
        ['RECOLHIMENTO DARF — TOTAIS POR CÓDIGO DE RECEITA'],
        [`Período: ${monthNames[month]}/${year}`],
        ['Portaria SPA/MF nº 1.287/2026 — DARF 5862 inclui FUNAPOL caput escalonado.'],
        [''],
        ['Código', 'Descrição', 'Inclui FUNAPOL caput?', 'Valor (R$)'],
      ];
      for (const d of dest.darf_codes) {
        darfRows.push([
          d.codigo,
          d.descricao,
          d.includes_funapol_caput ? 'Sim' : 'Não',
          fmtBRL(d.total_centavos),
        ]);
      }
      darfRows.push([]);
      darfRows.push(['TOTAL DARF (R$)', '', '', fmtBRL(dest.darf_codes.reduce((s: bigint, d: any) => s + BigInt(d.total_centavos), 0n).toString())]);
      const wsDarf = XLSX.utils.aoa_to_sheet(darfRows);
      wsDarf['!cols'] = [{ wch: 10 }, { wch: 60 }, { wch: 22 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsDarf, 'DARF por código');
    }

    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeName = (report.company.name ?? 'empresa').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
    const filename = `apuracao-ggr-${safeName}-${String(month).padStart(2, '0')}-${year}.xlsx`;
    return { buffer, filename };
  }
}

@ApiTags('ggr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('ggr')
export class GgrController {
  constructor(private service: GgrService) {}

  // OPERADOR (gestor de marca) pode importar GGR das suas marcas — é dado operacional dele.
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Post('import')
  importFile(@Body() dto: ImportGgrDto, @CurrentUser() user: any) {
    return this.service.importFile(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Post('manual')
  createManual(@Body() dto: ManualGgrDto, @CurrentUser() user: any) {
    return this.service.createManual(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
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

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
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

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('apurations')
  listApurations(@Query() q: any, @CurrentUser() user: any) {
    return this.service.listApurations(q, user);
  }

  /** Calcula a apuração de TODAS as marcas de uma empresa de uma só vez. */
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Post('calculate-all/:companyId/:year/:month')
  calculateAllForCompany(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @CurrentUser() user: any,
  ) {
    return this.service.calculateAllForCompany(companyId, parseInt(year), parseInt(month), user);
  }

  /** Relatório consolidado de apuração mensal por empresa (com filtro opcional ?brand_id=). */
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('report/:companyId/:year/:month')
  getApurationReport(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.service.getApurationReport(companyId, parseInt(year), parseInt(month), user, brandId);
  }

  /** Exporta o relatório consolidado em Excel (.xlsx). Aceita ?brand_id=. */
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('report/:companyId/:year/:month/export')
  async exportApurationReport(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportApurationReportXlsx(
      companyId, parseInt(year), parseInt(month), user, brandId,
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** Exporta o relatório consolidado em PDF. Aceita ?brand_id=. */
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('report/:companyId/:year/:month/export-pdf')
  async exportApurationReportPdf(
    @Param('companyId') companyId: string,
    @Param('year') year: string,
    @Param('month') month: string,
    @Query('brand_id') brandId: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportApurationReportPdf(
      companyId, parseInt(year), parseInt(month), user, brandId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
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

  /**
   * Modelo Excel (.xlsx) pronto para envio ao cliente.
   * Aceita query params opcionais:
   *   - brand_id: usa o nome da marca no nome do arquivo
   *   - days:     quantos dias pr\u00e9-popular (default 31)
   */
  @Get('template-xlsx')
  async downloadTemplateXlsx(
    @Query('brand_id') brandId: string | undefined,
    @Query('days') daysQuery: string | undefined,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const brandName = brandId ? await this.service.getBrandName(brandId) : undefined;
    const days = Math.max(1, Math.min(366, parseInt(daysQuery ?? '31', 10) || 31));
    const { buffer, filename } = generateGgrTemplateXLSX({ brandName, days });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [GgrController],
  providers: [GgrService],
  exports: [GgrService],
})
export class GgrModule {}
