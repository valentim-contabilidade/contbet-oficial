import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsString, IsOptional, IsDateString } from 'class-validator';
import {
  Profile, AuditAlertLevel, AuditCheckType,
  StatementLineType, PaymentStatus, IrpjApurationStatus, GgrApurationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { serializeBigInt } from '../financial/money.helper';

// =================== DTOs ===================

export class MovementsCheckDto {
  @IsString() company_id: string;
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsString() notes?: string;
}

export class FeesCheckDto {
  @IsString() company_id: string;
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsString() notes?: string;
}

export class TaxesCheckDto {
  @IsString() company_id: string;
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsString() notes?: string;
}

// =================== TOLERÂNCIAS ===================
export const WARNING_PCT = 0.01;
export const CRITICAL_PCT = 0.05;
export const MIN_TOLERANCE_CENTS = 10_000n; // R$ 100,00

function bigMax(a: bigint, b: bigint) { return a > b ? a : b; }

function calcAlertLevel(diffNet: bigint, expectedNet: bigint): AuditAlertLevel {
  const absDiff = diffNet < 0n ? -diffNet : diffNet;
  const expectedAbs = expectedNet < 0n ? -expectedNet : expectedNet;
  const warnTol = bigMax(MIN_TOLERANCE_CENTS, BigInt(Math.round(Number(expectedAbs) * WARNING_PCT)));
  const critTol = bigMax(MIN_TOLERANCE_CENTS, BigInt(Math.round(Number(expectedAbs) * CRITICAL_PCT)));
  if (absDiff <= warnTol) return AuditAlertLevel.OK;
  if (absDiff <= critTol) return AuditAlertLevel.WARNING;
  return AuditAlertLevel.CRITICAL;
}

// =================== SERVICE ===================

@Injectable()
export class AuditChecksService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private assertCompanyAccess(companyId: string, current: any) {
    if (current.profile === Profile.ADMIN) return;
    if (current.profile === Profile.MANAGER && current.company_id === companyId) return;
    throw new BadRequestException('Sem acesso a esta empresa.');
  }

  async movementsCheck(dto: MovementsCheckDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);

    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (from > to) throw new BadRequestException('Período inválido: "de" maior que "até".');

    const ggrRecords = await this.prisma.ggrDailyRecord.findMany({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        date: { gte: from, lte: to },
      },
      select: { date: true, total_deposits: true, total_withdrawals: true, brand_id: true },
    });

    const sistemaPorDia = new Map<string, { deposits: bigint; withdrawals: bigint }>();
    for (const r of ggrRecords) {
      const key = r.date.toISOString().slice(0, 10);
      const cur = sistemaPorDia.get(key) ?? { deposits: 0n, withdrawals: 0n };
      cur.deposits += r.total_deposits;
      cur.withdrawals += r.total_withdrawals;
      sistemaPorDia.set(key, cur);
    }

    const playerAccounts = await this.prisma.bankAccount.findMany({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        is_player_wallet: true,
      },
      select: { id: true, name: true },
    });
    const accountIds = playerAccounts.map(a => a.id);

    let bancoLines: { date: Date; amount: bigint; type: StatementLineType }[] = [];
    if (accountIds.length > 0) {
      bancoLines = await this.prisma.bankStatementLine.findMany({
        where: {
          statement: { bank_account_id: { in: accountIds }, metadeleted: false },
          date: { gte: from, lte: to },
        },
        select: { date: true, amount: true, type: true },
      });
    }

    const bancoPorDia = new Map<string, { deposits: bigint; withdrawals: bigint }>();
    for (const l of bancoLines) {
      const key = l.date.toISOString().slice(0, 10);
      const cur = bancoPorDia.get(key) ?? { deposits: 0n, withdrawals: 0n };
      if (l.type === StatementLineType.CREDIT) cur.deposits += l.amount;
      else cur.withdrawals += l.amount;
      bancoPorDia.set(key, cur);
    }

    const allDates = new Set<string>([...sistemaPorDia.keys(), ...bancoPorDia.keys()]);
    const dailyBreakdown: Array<{
      date: string;
      sistema_deposits: string; sistema_withdrawals: string; sistema_net: string;
      banco_deposits: string;   banco_withdrawals: string;   banco_net: string;
      diff_deposits: string;    diff_withdrawals: string;    diff_net: string;
      cumulative_diff_net: string;
    }> = [];

    let totSistemaDep = 0n, totSistemaSaq = 0n;
    let totBancoDep = 0n, totBancoSaq = 0n;
    let cumDiff = 0n;

    Array.from(allDates).sort().forEach(date => {
      const sis = sistemaPorDia.get(date) ?? { deposits: 0n, withdrawals: 0n };
      const bnc = bancoPorDia.get(date)   ?? { deposits: 0n, withdrawals: 0n };
      const sisNet = sis.deposits - sis.withdrawals;
      const bncNet = bnc.deposits - bnc.withdrawals;
      const diffDep = bnc.deposits    - sis.deposits;
      const diffSaq = bnc.withdrawals - sis.withdrawals;
      const diffNet = bncNet - sisNet;
      cumDiff += diffNet;

      totSistemaDep += sis.deposits;
      totSistemaSaq += sis.withdrawals;
      totBancoDep   += bnc.deposits;
      totBancoSaq   += bnc.withdrawals;

      dailyBreakdown.push({
        date,
        sistema_deposits:    sis.deposits.toString(),
        sistema_withdrawals: sis.withdrawals.toString(),
        sistema_net:         sisNet.toString(),
        banco_deposits:      bnc.deposits.toString(),
        banco_withdrawals:   bnc.withdrawals.toString(),
        banco_net:           bncNet.toString(),
        diff_deposits:       diffDep.toString(),
        diff_withdrawals:    diffSaq.toString(),
        diff_net:            diffNet.toString(),
        cumulative_diff_net: cumDiff.toString(),
      });
    });

    const sistemaNet = totSistemaDep - totSistemaSaq;
    const bancoNet = totBancoDep - totBancoSaq;
    const diffDeposits = totBancoDep - totSistemaDep;
    const diffWithdrawals = totBancoSaq - totSistemaSaq;
    const diffNet = bancoNet - sistemaNet;

    const alertLevel = calcAlertLevel(diffNet, sistemaNet);

    const log = await this.prisma.auditMovementsCheck.create({
      data: {
        from_date: from,
        to_date: to,
        sistema_deposits: totSistemaDep,
        sistema_withdrawals: totSistemaSaq,
        sistema_net: sistemaNet,
        banco_deposits: totBancoDep,
        banco_withdrawals: totBancoSaq,
        banco_net: bancoNet,
        diff_deposits: diffDeposits,
        diff_withdrawals: diffWithdrawals,
        diff_net: diffNet,
        alert_level: alertLevel,
        notes: dto.notes,
        daily_breakdown: dailyBreakdown as any,
        company_id: dto.company_id,
        triggered_by_user_id: current.id,
      },
    });
    await this.audit.log('MOVEMENTS_CHECK', 'AUDIT_MOVEMENTS_CHECK', log.id, current.id, {
      from: dto.from, to: dto.to, alert_level: alertLevel,
    });
    await this.maybeCreateAlert({
      company_id: dto.company_id, check_type: AuditCheckType.MOVEMENTS,
      reference_id: log.id, current_level: alertLevel,
    });

    return serializeBigInt({
      check_id: log.id,
      created_at: log.created_at,
      from: dto.from,
      to: dto.to,
      tolerance: { warning_pct: WARNING_PCT, critical_pct: CRITICAL_PCT, min_cents: MIN_TOLERANCE_CENTS.toString() },
      totals: {
        sistema: {
          deposits: totSistemaDep.toString(),
          withdrawals: totSistemaSaq.toString(),
          net: sistemaNet.toString(),
        },
        banco: {
          deposits: totBancoDep.toString(),
          withdrawals: totBancoSaq.toString(),
          net: bancoNet.toString(),
        },
        diff: {
          deposits: diffDeposits.toString(),
          withdrawals: diffWithdrawals.toString(),
          net: diffNet.toString(),
        },
      },
      alert_level: alertLevel,
      player_accounts: playerAccounts,
      daily_breakdown: dailyBreakdown,
      has_data: ggrRecords.length > 0 || bancoLines.length > 0,
      missing_player_account: playerAccounts.length === 0,
    });
  }

  async feesCheck(dto: FeesCheckDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);

    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (from > to) throw new BadRequestException('Período inválido: "de" maior que "até".');

    const ggrAgg = await this.prisma.ggrDailyRecord.aggregate({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        date: { gte: from, lte: to },
      },
      _sum: { deposit_count: true, withdrawal_count: true },
    });
    const totalDeposits = ggrAgg._sum.deposit_count ?? 0;
    const totalWithdrawals = ggrAgg._sum.withdrawal_count ?? 0;

    const playerAccounts = await this.prisma.bankAccount.findMany({
      where: {
        company_id: dto.company_id,
        metadeleted: false,
        is_player_wallet: true,
      },
    });

    let avgFeeCredit = 0n;
    let avgFeeDebit = 0n;
    const perAccount: any[] = [];

    if (playerAccounts.length > 0) {
      const sumCredit = playerAccounts.reduce((s, a) => s + a.fee_per_credit, 0n);
      const sumDebit  = playerAccounts.reduce((s, a) => s + a.fee_per_debit, 0n);
      avgFeeCredit = sumCredit / BigInt(playerAccounts.length);
      avgFeeDebit  = sumDebit  / BigInt(playerAccounts.length);

      const perAccountDeposits  = Math.floor(totalDeposits / playerAccounts.length);
      const perAccountWithdraws = Math.floor(totalWithdrawals / playerAccounts.length);
      for (const a of playerAccounts) {
        const expected = a.fee_per_credit * BigInt(perAccountDeposits) + a.fee_per_debit * BigInt(perAccountWithdraws);
        perAccount.push({
          account_id: a.id,
          account_name: a.name,
          fee_per_credit: a.fee_per_credit.toString(),
          fee_per_debit:  a.fee_per_debit.toString(),
          deposits_count: perAccountDeposits,
          withdrawals_count: perAccountWithdraws,
          expected_fees: expected.toString(),
        });
      }
    }

    const expectedCreditFees = avgFeeCredit * BigInt(totalDeposits);
    const expectedDebitFees  = avgFeeDebit  * BigInt(totalWithdrawals);
    const expectedTotalFees  = expectedCreditFees + expectedDebitFees;

    let actualTotalFees = 0n;
    if (playerAccounts.length > 0) {
      const accountIds = playerAccounts.map(a => a.id);
      const feeLines = await this.prisma.bankStatementLine.findMany({
        where: {
          statement: { bank_account_id: { in: accountIds }, metadeleted: false },
          date: { gte: from, lte: to },
          OR: [
            { description: { contains: 'tarifa', mode: 'insensitive' } },
            { description: { contains: 'tar.', mode: 'insensitive' } },
            { description: { contains: 'tar pix', mode: 'insensitive' } },
          ],
          type: 'DEBIT',
        },
        select: { amount: true },
      });
      actualTotalFees = feeLines.reduce((s, l) => s + l.amount, 0n);
    }

    const diffTotalFees = actualTotalFees - expectedTotalFees;
    const alertLevel = calcAlertLevel(diffTotalFees, expectedTotalFees);

    const log = await this.prisma.auditFeesCheck.create({
      data: {
        from_date: from,
        to_date: to,
        total_deposits_count: totalDeposits,
        total_withdrawals_count: totalWithdrawals,
        expected_credit_fees: expectedCreditFees,
        expected_debit_fees: expectedDebitFees,
        expected_total_fees: expectedTotalFees,
        actual_total_fees: actualTotalFees,
        diff_total_fees: diffTotalFees,
        alert_level: alertLevel,
        notes: dto.notes,
        per_account_breakdown: perAccount as any,
        company_id: dto.company_id,
        triggered_by_user_id: current.id,
      },
    });
    await this.audit.log('FEES_CHECK', 'AUDIT_FEES_CHECK', log.id, current.id, {
      from: dto.from, to: dto.to, expected: expectedTotalFees.toString(), actual: actualTotalFees.toString(),
    });
    await this.maybeCreateAlert({
      company_id: dto.company_id, check_type: AuditCheckType.FEES,
      reference_id: log.id, current_level: alertLevel,
    });

    return serializeBigInt({
      check_id: log.id,
      created_at: log.created_at,
      from: dto.from,
      to: dto.to,
      tolerance: { warning_pct: WARNING_PCT, critical_pct: CRITICAL_PCT, min_cents: MIN_TOLERANCE_CENTS.toString() },
      sistema: {
        deposits_count: totalDeposits,
        withdrawals_count: totalWithdrawals,
      },
      rates: {
        avg_fee_per_credit: avgFeeCredit.toString(),
        avg_fee_per_debit: avgFeeDebit.toString(),
      },
      expected: {
        credit_fees: expectedCreditFees.toString(),
        debit_fees: expectedDebitFees.toString(),
        total_fees: expectedTotalFees.toString(),
      },
      actual: {
        total_fees: actualTotalFees.toString(),
      },
      diff: {
        total_fees: diffTotalFees.toString(),
      },
      alert_level: alertLevel,
      per_account_breakdown: perAccount,
      missing_player_account: playerAccounts.length === 0,
      missing_rates: playerAccounts.length > 0 && avgFeeCredit === 0n && avgFeeDebit === 0n,
    });
  }

  async taxesCheck(dto: TaxesCheckDto, current: any) {
    this.assertCompanyAccess(dto.company_id, current);
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (from > to) throw new BadRequestException('Período inválido.');

    type TaxItem = {
      apuration_id: string; period_label: string;
      calculated: bigint; paid: bigint; diff: bigint;
      payable_ids: string[];
    };
    type TaxBucket = { type: string; calculated: bigint; paid: bigint; diff: bigint; items: TaxItem[] };
    const buckets: Record<string, TaxBucket> = {};
    const ensure = (type: string): TaxBucket => {
      if (!buckets[type]) buckets[type] = { type, calculated: 0n, paid: 0n, diff: 0n, items: [] };
      return buckets[type];
    };

    const irpjs = await this.prisma.irpjCsllApuration.findMany({
      where: {
        company_id: dto.company_id, metadeleted: false,
        status: { in: [IrpjApurationStatus.CLOSED, IrpjApurationStatus.PAID] },
        closed_at: { gte: from, lte: to },
      },
      include: { generated_payables: true },
    });
    for (const a of irpjs) {
      const period = a.period_type === 'TRIMESTRAL' && a.quarter
        ? `${a.quarter}T/${a.year}` : `${String(a.month).padStart(2, '0')}/${a.year}`;
      const irpjPayable = a.generated_payables.find(p => /irpj/i.test(p.description));
      const irpjPaid = irpjPayable && irpjPayable.status === PaymentStatus.PAID ? irpjPayable.paid_amount : 0n;
      if (a.irpj_total > 0n || irpjPaid > 0n) {
        const b = ensure('IRPJ');
        const item: TaxItem = {
          apuration_id: a.id, period_label: period,
          calculated: a.irpj_total, paid: irpjPaid, diff: irpjPaid - a.irpj_total,
          payable_ids: irpjPayable ? [irpjPayable.id] : [],
        };
        b.items.push(item);
        b.calculated += item.calculated; b.paid += item.paid; b.diff += item.diff;
      }
      const csllPayable = a.generated_payables.find(p => /csll/i.test(p.description));
      const csllPaid = csllPayable && csllPayable.status === PaymentStatus.PAID ? csllPayable.paid_amount : 0n;
      if (a.csll_amount > 0n || csllPaid > 0n) {
        const b = ensure('CSLL');
        const item: TaxItem = {
          apuration_id: a.id, period_label: period,
          calculated: a.csll_amount, paid: csllPaid, diff: csllPaid - a.csll_amount,
          payable_ids: csllPayable ? [csllPayable.id] : [],
        };
        b.items.push(item);
        b.calculated += item.calculated; b.paid += item.paid; b.diff += item.diff;
      }
    }

    const pisCofins = await this.prisma.pisCofinsApuration.findMany({
      where: {
        company_id: dto.company_id, metadeleted: false,
        status: { in: ['CLOSED', 'PAID'] },
        closed_at: { gte: from, lte: to },
      },
      include: { generated_payables: true },
    });
    for (const a of pisCofins) {
      const period = `${String(a.month).padStart(2, '0')}/${a.year}`;
      const pisP = a.generated_payables.find(p => /pis/i.test(p.description));
      const cofP = a.generated_payables.find(p => /cofins/i.test(p.description));
      const pisPaid = pisP && pisP.status === PaymentStatus.PAID ? pisP.paid_amount : 0n;
      const cofPaid = cofP && cofP.status === PaymentStatus.PAID ? cofP.paid_amount : 0n;
      if (a.pis_amount_payable > 0n || pisPaid > 0n) {
        const b = ensure('PIS');
        const item: TaxItem = {
          apuration_id: a.id, period_label: period,
          calculated: a.pis_amount_payable, paid: pisPaid, diff: pisPaid - a.pis_amount_payable,
          payable_ids: pisP ? [pisP.id] : [],
        };
        b.items.push(item);
        b.calculated += item.calculated; b.paid += item.paid; b.diff += item.diff;
      }
      if (a.cofins_amount_payable > 0n || cofPaid > 0n) {
        const b = ensure('COFINS');
        const item: TaxItem = {
          apuration_id: a.id, period_label: period,
          calculated: a.cofins_amount_payable, paid: cofPaid, diff: cofPaid - a.cofins_amount_payable,
          payable_ids: cofP ? [cofP.id] : [],
        };
        b.items.push(item);
        b.calculated += item.calculated; b.paid += item.paid; b.diff += item.diff;
      }
    }

    const issAprs = await this.prisma.issApuration.findMany({
      where: {
        company_id: dto.company_id, metadeleted: false,
        status: { in: ['CLOSED', 'PAID'] },
        closed_at: { gte: from, lte: to },
      },
      include: { generated_payables: true },
    });
    for (const a of issAprs) {
      const period = `${String(a.month).padStart(2, '0')}/${a.year}`;
      const p = a.generated_payables[0];
      const paid = p && p.status === PaymentStatus.PAID ? p.paid_amount : 0n;
      if (a.iss_amount > 0n || paid > 0n) {
        const b = ensure('ISS');
        const item: TaxItem = {
          apuration_id: a.id, period_label: period,
          calculated: a.iss_amount, paid, diff: paid - a.iss_amount,
          payable_ids: p ? [p.id] : [],
        };
        b.items.push(item);
        b.calculated += item.calculated; b.paid += item.paid; b.diff += item.diff;
      }
    }

    const ggrAprs = await this.prisma.ggrMonthlyApuration.findMany({
      where: {
        company_id: dto.company_id, metadeleted: false,
        status: { in: [GgrApurationStatus.CLOSED, GgrApurationStatus.PAID] },
        closed_at: { gte: from, lte: to },
      },
      include: { generated_payables: true },
    });
    for (const a of ggrAprs) {
      const period = `${String(a.month).padStart(2, '0')}/${a.year}`;
      const lei = a.generated_payables.find(p => /14\.790|lei 14\.790|lei14790/i.test(p.description));
      const leiPaid = lei && lei.status === PaymentStatus.PAID ? lei.paid_amount : 0n;
      if (a.tax_lei14790_amount > 0n || leiPaid > 0n) {
        const b = ensure('Lei 14.790');
        const item: TaxItem = {
          apuration_id: a.id, period_label: period,
          calculated: a.tax_lei14790_amount, paid: leiPaid, diff: leiPaid - a.tax_lei14790_amount,
          payable_ids: lei ? [lei.id] : [],
        };
        b.items.push(item);
        b.calculated += item.calculated; b.paid += item.paid; b.diff += item.diff;
      }
      // IRRF removido da auditoria — casas de apostas não retêm IRRF.
    }

    const totals = Object.values(buckets).reduce(
      (acc, b) => ({
        calculated: acc.calculated + b.calculated,
        paid: acc.paid + b.paid,
        diff: acc.diff + b.diff,
      }),
      { calculated: 0n, paid: 0n, diff: 0n },
    );

    const alertLevel = calcAlertLevel(totals.diff, totals.calculated);

    const breakdownSerialized = Object.values(buckets).map(b => ({
      type: b.type,
      calculated: b.calculated.toString(),
      paid: b.paid.toString(),
      diff: b.diff.toString(),
      items: b.items.map(it => ({
        apuration_id: it.apuration_id, period_label: it.period_label,
        calculated: it.calculated.toString(), paid: it.paid.toString(), diff: it.diff.toString(),
        payable_ids: it.payable_ids,
      })),
    }));

    const log = await this.prisma.auditTaxesCheck.create({
      data: {
        from_date: from, to_date: to,
        calculated_total: totals.calculated,
        paid_total: totals.paid,
        diff_total: totals.diff,
        per_tax_breakdown: breakdownSerialized as any,
        alert_level: alertLevel,
        notes: dto.notes,
        company_id: dto.company_id,
        triggered_by_user_id: current.id,
      },
    });
    await this.audit.log('TAXES_CHECK', 'AUDIT_TAXES_CHECK', log.id, current.id, {
      from: dto.from, to: dto.to, alert_level: alertLevel,
    });

    await this.maybeCreateAlert({
      company_id: dto.company_id,
      check_type: AuditCheckType.TAXES,
      reference_id: log.id,
      current_level: alertLevel,
    });

    return serializeBigInt({
      check_id: log.id,
      created_at: log.created_at,
      from: dto.from, to: dto.to,
      tolerance: { warning_pct: WARNING_PCT, critical_pct: CRITICAL_PCT, min_cents: MIN_TOLERANCE_CENTS.toString() },
      totals: {
        calculated: totals.calculated.toString(),
        paid: totals.paid.toString(),
        diff: totals.diff.toString(),
      },
      per_tax_breakdown: breakdownSerialized,
      alert_level: alertLevel,
      has_data: Object.keys(buckets).length > 0,
    });
  }

  private async maybeCreateAlert(args: {
    company_id: string; check_type: AuditCheckType; reference_id: string; current_level: AuditAlertLevel;
  }) {
    if (args.current_level === AuditAlertLevel.OK) return;

    const lastAlert = await this.prisma.auditAlert.findFirst({
      where: { company_id: args.company_id, check_type: args.check_type, metadeleted: false },
      orderBy: { created_at: 'desc' },
    });
    const previousLevel = lastAlert?.current_level ?? AuditAlertLevel.OK;

    const ranking: Record<AuditAlertLevel, number> = { OK: 0, WARNING: 1, CRITICAL: 2 };
    if (ranking[args.current_level] <= ranking[previousLevel]) return;

    await this.prisma.auditAlert.create({
      data: {
        check_type: args.check_type,
        reference_id: args.reference_id,
        previous_level: lastAlert?.current_level ?? null,
        current_level: args.current_level,
        message: `Auditoria ${args.check_type} mudou para ${args.current_level}.`,
        company_id: args.company_id,
      },
    });
  }

  async listAllChecks(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);
    const [movements, fees, taxes] = await Promise.all([
      this.prisma.auditMovementsCheck.findMany({
        where: { company_id: companyId, metadeleted: false },
        orderBy: { created_at: 'desc' },
        select: {
          id: true, created_at: true, from_date: true, to_date: true,
          alert_level: true, diff_net: true, sistema_net: true, banco_net: true,
        },
      }),
      this.prisma.auditFeesCheck.findMany({
        where: { company_id: companyId, metadeleted: false },
        orderBy: { created_at: 'desc' },
        select: {
          id: true, created_at: true, from_date: true, to_date: true,
          alert_level: true, expected_total_fees: true, actual_total_fees: true, diff_total_fees: true,
        },
      }),
      this.prisma.auditTaxesCheck.findMany({
        where: { company_id: companyId, metadeleted: false },
        orderBy: { created_at: 'desc' },
        select: {
          id: true, created_at: true, from_date: true, to_date: true,
          alert_level: true, calculated_total: true, paid_total: true, diff_total: true,
        },
      }),
    ]);
    return serializeBigInt({
      movements: movements.map(c => ({ ...c, type: 'MOVEMENTS' })),
      fees:      fees.map(c => ({ ...c, type: 'FEES' })),
      taxes:     taxes.map(c => ({ ...c, type: 'TAXES' })),
    });
  }

  async listAlerts(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);
    const data = await this.prisma.auditAlert.findMany({
      where: { company_id: companyId, metadeleted: false },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return serializeBigInt({ data });
  }

  async ackAlert(id: string, current: any) {
    const alert = await this.prisma.auditAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerta não encontrado.');
    this.assertCompanyAccess(alert.company_id, current);
    await this.prisma.auditAlert.update({
      where: { id },
      data: { acknowledged: true, acknowledged_at: new Date(), acknowledged_by_user_id: current.id },
    });
    return { ok: true };
  }

  async listChecks(companyId: string, current: any) {
    this.assertCompanyAccess(companyId, current);
    const data = await this.prisma.auditMovementsCheck.findMany({
      where: { company_id: companyId, metadeleted: false },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return serializeBigInt({ data });
  }

  async getCheck(id: string, current: any) {
    const c = await this.prisma.auditMovementsCheck.findUnique({ where: { id } });
    if (!c || c.metadeleted) throw new NotFoundException('Verificação não encontrada.');
    this.assertCompanyAccess(c.company_id, current);
    return serializeBigInt(c);
  }
}
