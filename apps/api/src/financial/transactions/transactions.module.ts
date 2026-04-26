import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsNumber, IsDateString, Min } from 'class-validator';
import { TransactionType, Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';

class CreateTransactionDto {
  @IsString() @MinLength(2) @MaxLength(255) description: string;
  @IsNumber() @Min(1) amount: number;
  @IsEnum(TransactionType) type: TransactionType;
  @IsDateString() date: string;
  @IsString() bank_account_id: string;
  @IsOptional() @IsString() destination_account_id?: string;
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() account_id?: string;
  @IsOptional() @IsString() brand_id?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() company_id?: string;
}

class UpdateTransactionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() account_id?: string;
}

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateTransactionDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: dto.bank_account_id } });
    if (!bank || bank.metadeleted) throw new BadRequestException('Conta bancária inválida.');
    assertTenantAccess(bank, current);

    if (dto.type === TransactionType.TRANSFER) {
      if (!dto.destination_account_id) throw new BadRequestException('Transferência exige conta destino.');
      if (dto.destination_account_id === dto.bank_account_id) throw new BadRequestException('Conta origem e destino não podem ser iguais.');
      const dest = await this.prisma.bankAccount.findUnique({ where: { id: dto.destination_account_id } });
      if (!dest || dest.metadeleted) throw new BadRequestException('Conta destino inválida.');
      assertTenantAccess(dest, current);
    }

    const amount = BigInt(dto.amount);
    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          description: dto.description,
          amount,
          type: dto.type,
          date: new Date(dto.date),
          company_id,
          brand_id: dto.brand_id,
          bank_account_id: dto.bank_account_id,
          destination_account_id: dto.destination_account_id,
          category_id: dto.category_id,
          account_id: dto.account_id,
          notes: dto.notes,
          reference: dto.reference,
        },
      });

      // Atualiza saldos
      if (dto.type === TransactionType.INCOME) {
        await tx.bankAccount.update({
          where: { id: dto.bank_account_id },
          data: { current_balance: { increment: amount } },
        });
      } else if (dto.type === TransactionType.EXPENSE) {
        await tx.bankAccount.update({
          where: { id: dto.bank_account_id },
          data: { current_balance: { decrement: amount } },
        });
      } else if (dto.type === TransactionType.TRANSFER) {
        await tx.bankAccount.update({
          where: { id: dto.bank_account_id },
          data: { current_balance: { decrement: amount } },
        });
        await tx.bankAccount.update({
          where: { id: dto.destination_account_id! },
          data: { current_balance: { increment: amount } },
        });
      }

      return transaction;
    });

    await this.audit.log('CREATE', 'TRANSACTION', result.id, current.id);
    return serializeBigInt(result);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.description) where.description = { contains: filters.description, mode: 'insensitive' };
    if (filters.type) where.type = filters.type;
    if (filters.bank_account_id) where.bank_account_id = filters.bank_account_id;
    if (filters.category_id) where.category_id = filters.category_id;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.date_from || filters.date_to) {
      where.date = {};
      if (filters.date_from) where.date.gte = new Date(filters.date_from);
      if (filters.date_to) where.date.lte = new Date(filters.date_to);
    }

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        include: {
          bank_account: { select: { id: true, name: true } },
          destination_account: { select: { id: true, name: true } },
          category: { select: { id: true, name: true, color: true } },
          brand: { select: { id: true, name: true } },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const t = await this.prisma.transaction.findUnique({
      where: { id },
      include: { bank_account: true, destination_account: true, category: true, account: true, brand: true, payable: true, receivable: true },
    });
    if (!t || t.metadeleted) throw new NotFoundException('Lançamento não encontrado.');
    assertTenantAccess(t, current);
    return serializeBigInt(t);
  }

  async update(id: string, dto: UpdateTransactionDto, current: any) {
    await this.findOne(id, current);
    const updated = await this.prisma.transaction.update({ where: { id }, data: dto });
    await this.audit.log('UPDATE', 'TRANSACTION', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    const t = await this.findOne(id, current);
    if (t.payable_id || t.receivable_id) {
      throw new BadRequestException('Lançamentos vinculados a contas a pagar/receber não podem ser excluídos diretamente. Estorne o pagamento na conta correspondente.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.update({ where: { id }, data: { metadeleted: true } });
      // Reverte saldo
      const amount = BigInt(t.amount);
      if (t.type === 'INCOME') {
        await tx.bankAccount.update({ where: { id: t.bank_account_id }, data: { current_balance: { decrement: amount } } });
      } else if (t.type === 'EXPENSE') {
        await tx.bankAccount.update({ where: { id: t.bank_account_id }, data: { current_balance: { increment: amount } } });
      } else if (t.type === 'TRANSFER') {
        await tx.bankAccount.update({ where: { id: t.bank_account_id }, data: { current_balance: { increment: amount } } });
        if (t.destination_account_id) {
          await tx.bankAccount.update({ where: { id: t.destination_account_id }, data: { current_balance: { decrement: amount } } });
        }
      }
    });
    await this.audit.log('DELETE', 'TRANSACTION', id, current.id);
    return { ok: true };
  }
}

// =================== RELATÓRIOS / DASHBOARD ===================

@Injectable()
export class FinancialReportsService {
  constructor(private prisma: PrismaService) {}

  async dashboard(current: any, filters: { company_id?: string; brand_id?: string; year?: number; month?: number }) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.brand_id) where.brand_id = filters.brand_id;

    const now = new Date();
    const year = filters.year ?? now.getFullYear();
    const month = filters.month ?? now.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    // Saldo total das contas bancárias
    const accounts = await this.prisma.bankAccount.findMany({
      where: { ...where, is_active: true },
    });
    const totalBalance = accounts.reduce((sum, a) => sum + a.current_balance, 0n);

    // A pagar (pendente + vencido)
    const payableAgg = await this.prisma.accountPayable.aggregate({
      where: { ...where, status: { in: ['PENDING', 'OVERDUE'] } },
      _sum: { amount: true, paid_amount: true },
      _count: true,
    });

    // A receber (pendente + vencido)
    const receivableAgg = await this.prisma.accountReceivable.aggregate({
      where: { ...where, status: { in: ['PENDING', 'OVERDUE'] } },
      _sum: { amount: true, received_amount: true },
      _count: true,
    });

    // Vencidos
    const overduePayable = await this.prisma.accountPayable.aggregate({
      where: { ...where, status: 'OVERDUE' },
      _sum: { amount: true }, _count: true,
    });
    const overdueReceivable = await this.prisma.accountReceivable.aggregate({
      where: { ...where, status: 'OVERDUE' },
      _sum: { amount: true }, _count: true,
    });

    // Movimento do mês
    const monthIncome = await this.prisma.transaction.aggregate({
      where: { ...where, type: 'INCOME', date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    });
    const monthExpense = await this.prisma.transaction.aggregate({
      where: { ...where, type: 'EXPENSE', date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    });

    return serializeBigInt({
      balance: { total: totalBalance, accounts_count: accounts.length },
      payable: {
        pending_total: (payableAgg._sum.amount ?? 0n) - (payableAgg._sum.paid_amount ?? 0n),
        count: payableAgg._count,
        overdue_total: overduePayable._sum.amount ?? 0n,
        overdue_count: overduePayable._count,
      },
      receivable: {
        pending_total: (receivableAgg._sum.amount ?? 0n) - (receivableAgg._sum.received_amount ?? 0n),
        count: receivableAgg._count,
        overdue_total: overdueReceivable._sum.amount ?? 0n,
        overdue_count: overdueReceivable._count,
      },
      month: {
        income: monthIncome._sum.amount ?? 0n,
        expense: monthExpense._sum.amount ?? 0n,
        net: (monthIncome._sum.amount ?? 0n) - (monthExpense._sum.amount ?? 0n),
        year, month,
      },
    });
  }

  async cashFlow(current: any, filters: { company_id?: string; brand_id?: string; year?: number }) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.brand_id) where.brand_id = filters.brand_id;

    const year = filters.year ?? new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    const transactions = await this.prisma.transaction.findMany({
      where: { ...where, date: { gte: yearStart, lte: yearEnd }, type: { in: ['INCOME', 'EXPENSE'] } },
      select: { date: true, type: true, amount: true },
    });

    // Agrupa por mês
    const months: Array<{ month: number; income: bigint; expense: bigint; net: bigint }> = [];
    for (let m = 1; m <= 12; m++) months.push({ month: m, income: 0n, expense: 0n, net: 0n });
    for (const t of transactions) {
      const m = months[t.date.getMonth()];
      if (t.type === 'INCOME') m.income += t.amount;
      else m.expense += t.amount;
    }
    for (const m of months) m.net = m.income - m.expense;

    return serializeBigInt({ year, months });
  }
}

@ApiTags('financial/transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/transactions')
export class TransactionsController {
  constructor(private service: TransactionsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateTransactionDto, @CurrentUser() user: any) { return this.service.create(dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) { return this.service.findAll(q, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.service.findOne(id, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTransactionDto, @CurrentUser() user: any) { return this.service.update(id, dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) { return this.service.remove(id, user); }
}

@ApiTags('financial/reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/reports')
export class FinancialReportsController {
  constructor(private service: FinancialReportsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('dashboard')
  dashboard(@Query() q: any, @CurrentUser() user: any) {
    return this.service.dashboard(user, {
      company_id: q.company_id,
      brand_id: q.brand_id,
      year: q.year ? parseInt(q.year, 10) : undefined,
      month: q.month ? parseInt(q.month, 10) : undefined,
    });
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('cash-flow')
  cashFlow(@Query() q: any, @CurrentUser() user: any) {
    return this.service.cashFlow(user, {
      company_id: q.company_id,
      brand_id: q.brand_id,
      year: q.year ? parseInt(q.year, 10) : undefined,
    });
  }
}

@Module({
  controllers: [TransactionsController, FinancialReportsController],
  providers: [TransactionsService, FinancialReportsService],
  exports: [TransactionsService, FinancialReportsService],
})
export class TransactionsModule {}
