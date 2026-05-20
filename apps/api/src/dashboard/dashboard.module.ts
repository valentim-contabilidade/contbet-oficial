import {
  Module, Injectable, BadRequestException,
  Controller, Get, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  Profile, PaymentStatus, GgrApurationStatus, IrpjApurationStatus,
  TaxApurationStatus, AuditAlertLevel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { serializeBigInt } from '../financial/money.helper';

type Period = 'current_month' | 'last_30_days' | 'last_90_days' | 'custom';

interface DashboardInput {
  company_id: string;
  period: Period;
  /** Apenas quando period = 'custom' (formato YYYY-MM-DD) */
  start_date?: string;
  end_date?: string;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async overview(input: DashboardInput, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== input.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    const company = await this.prisma.company.findUnique({ where: { id: input.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    // ============ Cálculo do período ============
    const now = new Date();
    let start: Date, end: Date, prevStart: Date, prevEnd: Date, label: string;
    if (input.period === 'current_month') {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      prevEnd   = start;
      label = `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;
    } else if (input.period === 'last_30_days') {
      end = new Date(now); end.setUTCHours(0, 0, 0, 0);
      end = new Date(end.getTime() + 86400000);
      start = new Date(end.getTime() - 30 * 86400000);
      prevEnd = start;
      prevStart = new Date(start.getTime() - 30 * 86400000);
      label = 'Últimos 30 dias';
    } else if (input.period === 'custom') {
      if (!input.start_date || !input.end_date) {
        throw new BadRequestException('Período personalizado exige start_date e end_date (YYYY-MM-DD).');
      }
      const s = new Date(input.start_date + 'T00:00:00.000Z');
      const e = new Date(input.end_date + 'T00:00:00.000Z');
      if (isNaN(s.getTime()) || isNaN(e.getTime())) {
        throw new BadRequestException('Datas inválidas. Use formato YYYY-MM-DD.');
      }
      if (s > e) {
        throw new BadRequestException('Data inicial não pode ser maior que a final.');
      }
      start = s;
      end = new Date(e.getTime() + 86400000); // exclusivo
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
      prevEnd = start;
      prevStart = new Date(start.getTime() - days * 86400000);
      const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      label = `${fmt(s)} – ${fmt(e)}`;
    } else {
      end = new Date(now); end.setUTCHours(0, 0, 0, 0);
      end = new Date(end.getTime() + 86400000);
      start = new Date(end.getTime() - 90 * 86400000);
      prevEnd = start;
      prevStart = new Date(start.getTime() - 90 * 86400000);
      label = 'Últimos 90 dias';
    }

    const cid = input.company_id;

    // ============ KPIs ============

    // GGR do período (somatório de GgrDailyRecord.ggr)
    const ggrAggCur = await this.prisma.ggrDailyRecord.aggregate({
      where: { company_id: cid, metadeleted: false, date: { gte: start, lt: end } },
      _sum: { ggr: true, total_deposits: true, total_withdrawals: true, total_bets: true, total_prizes: true, deposit_count: true, withdrawal_count: true, active_players: true },
    });
    const ggrAggPrev = await this.prisma.ggrDailyRecord.aggregate({
      where: { company_id: cid, metadeleted: false, date: { gte: prevStart, lt: prevEnd } },
      _sum: { ggr: true },
    });
    const ggrCur  = ggrAggCur._sum.ggr ?? 0n;
    const ggrPrev = ggrAggPrev._sum.ggr ?? 0n;

    // Despesas do período (payables PAID, exceto DARFs — esses entram em "tributos")
    const expensesAgg = await this.prisma.accountPayable.aggregate({
      where: {
        company_id: cid, metadeleted: false, duplicate_of_id: null,
        status: PaymentStatus.PAID,
        source: { not: 'TAX_APURATION' },
        payment_date: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    const expensesPrevAgg = await this.prisma.accountPayable.aggregate({
      where: {
        company_id: cid, metadeleted: false, duplicate_of_id: null,
        status: PaymentStatus.PAID,
        source: { not: 'TAX_APURATION' },
        payment_date: { gte: prevStart, lt: prevEnd },
      },
      _sum: { amount: true },
    });
    const taxesAgg = await this.prisma.accountPayable.aggregate({
      where: {
        company_id: cid, metadeleted: false,
        source: 'TAX_APURATION',
        status: PaymentStatus.PAID,
        payment_date: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    const expensesCur = expensesAgg._sum.amount ?? 0n;
    const expensesPrev = expensesPrevAgg._sum.amount ?? 0n;
    const taxesCur = taxesAgg._sum.amount ?? 0n;

    // Lucro líquido estimado = GGR - despesas operacionais - tributos
    const netProfitCur = ggrCur - expensesCur - taxesCur;
    const netProfitPrev = ggrPrev - expensesPrev; // simplificado

    // Saldo em caixa (operacional, sem player_wallet)
    const bankAccounts = await this.prisma.bankAccount.findMany({
      where: { company_id: cid, metadeleted: false, is_active: true, is_player_wallet: false },
      select: { current_balance: true, name: true },
    });
    const cashBalance = bankAccounts.reduce((s, a) => s + a.current_balance, 0n);

    // Margem operacional = Lucro / GGR
    const margemCur  = ggrCur  > 0n ? Number((netProfitCur  * 10000n) / ggrCur)  / 100 : 0;
    const margemPrev = ggrPrev > 0n ? Number((netProfitPrev * 10000n) / ggrPrev) / 100 : 0;

    const variation = (cur: bigint, prev: bigint) => {
      if (prev === 0n) return null;
      return Number(((cur - prev) * 10000n) / prev) / 100;
    };

    // ============ Alertas ============

    const auditAlertsOpen = await this.prisma.auditAlert.count({
      where: { company_id: cid, metadeleted: false, acknowledged: false },
    });
    const auditCritical = await this.prisma.auditAlert.count({
      where: { company_id: cid, metadeleted: false, acknowledged: false, current_level: AuditAlertLevel.CRITICAL },
    });

    // DARFs vencendo nos próximos 7 dias
    const next7 = new Date(now); next7.setUTCDate(next7.getUTCDate() + 7);
    const darfsDue = await this.prisma.accountPayable.findMany({
      where: {
        company_id: cid, metadeleted: false,
        source: 'TAX_APURATION',
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
        due_date: { gte: now, lte: next7 },
      },
      select: { id: true, description: true, amount: true, due_date: true },
      orderBy: { due_date: 'asc' },
      take: 10,
    });

    // Apurações abertas
    const [openIrpj, openPisCofins, openIss, openGgr] = await Promise.all([
      this.prisma.irpjCsllApuration.count({ where: { company_id: cid, metadeleted: false, status: IrpjApurationStatus.OPEN } }),
      this.prisma.pisCofinsApuration.count({ where: { company_id: cid, metadeleted: false, status: TaxApurationStatus.OPEN } }),
      this.prisma.issApuration.count({ where: { company_id: cid, metadeleted: false, status: TaxApurationStatus.OPEN } }),
      this.prisma.ggrMonthlyApuration.count({ where: { company_id: cid, metadeleted: false, status: GgrApurationStatus.OPEN } }),
    ]);
    const openApurations = openIrpj + openPisCofins + openIss + openGgr;

    // Certificados A1 a vencer em 30 dias
    const next30 = new Date(now); next30.setUTCDate(next30.getUTCDate() + 30);
    const expiringCerts = await this.prisma.fiscalCertificate.findMany({
      where: {
        company_id: cid, metadeleted: false,
        valid_to: { lte: next30, gte: now },
      },
      select: { id: true, holder_name: true, valid_to: true },
      orderBy: { valid_to: 'asc' },
    });

    // ============ Série mensal de GGR (12 meses) ============

    const monthly: { year: number; month: number; label: string; ggr: bigint }[] = [];
    const baseY = now.getUTCFullYear();
    const baseM = now.getUTCMonth();
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    for (let i = 11; i >= 0; i--) {
      const y = baseY + Math.floor((baseM - i) / 12);
      const m = ((baseM - i) % 12 + 12) % 12;
      const mStart = new Date(Date.UTC(y, m, 1));
      const mEnd   = new Date(Date.UTC(y, m + 1, 1));
      const agg = await this.prisma.ggrDailyRecord.aggregate({
        where: { company_id: cid, metadeleted: false, date: { gte: mStart, lt: mEnd } },
        _sum: { ggr: true },
      });
      monthly.push({ year: y, month: m + 1, label: `${monthNames[m]}/${String(y).slice(2)}`, ggr: agg._sum.ggr ?? 0n });
    }

    // ============ Fluxo de caixa mensal (6 meses) ============

    const cashFlowMonthly: { year: number; month: number; label: string; inflows: bigint; outflows: bigint; net: bigint }[] = [];
    for (let i = 5; i >= 0; i--) {
      const y = baseY + Math.floor((baseM - i) / 12);
      const m = ((baseM - i) % 12 + 12) % 12;
      const mStart = new Date(Date.UTC(y, m, 1));
      const mEnd   = new Date(Date.UTC(y, m + 1, 1));
      const [ggrM, payM] = await Promise.all([
        this.prisma.ggrDailyRecord.aggregate({
          where: { company_id: cid, metadeleted: false, date: { gte: mStart, lt: mEnd } },
          _sum: { ggr: true },
        }),
        this.prisma.accountPayable.aggregate({
          where: { company_id: cid, metadeleted: false, status: PaymentStatus.PAID, duplicate_of_id: null, payment_date: { gte: mStart, lt: mEnd } },
          _sum: { amount: true },
        }),
      ]);
      const inflows  = ggrM._sum.ggr ?? 0n;
      const outflows = payM._sum.amount ?? 0n;
      cashFlowMonthly.push({
        year: y, month: m + 1, label: `${monthNames[m]}/${String(y).slice(2)}`,
        inflows, outflows, net: inflows - outflows,
      });
    }

    // ============ Top 5 categorias de despesa do período ============

    const expensesDetail = await this.prisma.accountPayable.findMany({
      where: {
        company_id: cid, metadeleted: false, duplicate_of_id: null,
        status: PaymentStatus.PAID,
        source: { not: 'TAX_APURATION' },
        payment_date: { gte: start, lt: end },
      },
      select: { amount: true, nature: { select: { name: true } } },
    });
    const byNature = new Map<string, bigint>();
    for (const e of expensesDetail) {
      const k = e.nature?.name ?? 'Outras';
      byNature.set(k, (byNature.get(k) ?? 0n) + e.amount);
    }
    const topExpenses = Array.from(byNature.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => Number(b.amount - a.amount))
      .slice(0, 5);

    // ============ Resumo fiscal ============

    const nfseIssued = await this.prisma.fiscalDocument.count({
      where: {
        company_id: cid, metadeleted: false,
        document_type: 'NFSE',
        direction: 'OUTGOING',
        issue_date: { gte: start, lt: end },
      },
    });
    const csrfPaid = await this.prisma.accountPayable.aggregate({
      where: {
        company_id: cid, metadeleted: false,
        source: 'TAX_APURATION',
        status: PaymentStatus.PAID,
        description: { contains: 'Retenção CSRF', mode: 'insensitive' },
        payment_date: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });

    // ============ Movimentação de apostadores ============

    const playerWallet = await this.prisma.bankAccount.aggregate({
      where: { company_id: cid, metadeleted: false, is_player_wallet: true },
      _sum: { current_balance: true },
    });

    return serializeBigInt({
      period: { type: input.period, label, start: start.toISOString(), end: end.toISOString() },
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      kpis: {
        ggr: { value: ggrCur, previous: ggrPrev, variation_percent: variation(ggrCur, ggrPrev) },
        net_profit: { value: netProfitCur, previous: netProfitPrev, variation_percent: variation(netProfitCur, netProfitPrev) },
        cash_balance: { value: cashBalance, accounts_count: bankAccounts.length },
        operational_margin: { value: margemCur, previous: margemPrev, delta: margemCur - margemPrev },
      },
      alerts: {
        audit_open: auditAlertsOpen,
        audit_critical: auditCritical,
        open_apurations: openApurations,
        darfs_due_7d: darfsDue,
        certificates_expiring_30d: expiringCerts,
      },
      ggr_monthly: monthly,
      cash_flow_monthly: cashFlowMonthly,
      top_expenses: topExpenses,
      fiscal_summary: {
        nfse_issued_count: nfseIssued,
        csrf_paid: csrfPaid._sum.amount ?? 0n,
      },
      player_movement: {
        deposits: ggrAggCur._sum.total_deposits ?? 0n,
        withdrawals: ggrAggCur._sum.total_withdrawals ?? 0n,
        deposit_count: ggrAggCur._sum.deposit_count ?? 0,
        withdrawal_count: ggrAggCur._sum.withdrawal_count ?? 0,
        wallet_balance: playerWallet._sum.current_balance ?? 0n,
        active_players: ggrAggCur._sum.active_players ?? 0,
      },
    });
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('overview')
  overview(@Query() q: any, @CurrentUser() user: any) {
    if (!q.company_id) throw new BadRequestException('company_id obrigatório.');
    const period = (q.period || 'current_month') as Period;
    return this.service.overview({
      company_id: q.company_id,
      period,
      start_date: q.start_date,
      end_date: q.end_date,
    }, user);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
