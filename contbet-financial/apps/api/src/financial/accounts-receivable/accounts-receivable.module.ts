import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsNumber, IsBoolean, IsDateString, Min } from 'class-validator';
import { PaymentStatus, Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';

class CreateAccountReceivableDto {
  @IsString() @MinLength(2) @MaxLength(255) description: string;
  @IsOptional() @IsString() @MaxLength(120) customer_name?: string;
  @IsOptional() @IsString() @MaxLength(20) customer_doc?: string;
  @IsOptional() @IsString() @MaxLength(50) document_number?: string;
  @IsNumber() @Min(1) amount: number;
  @IsDateString() issue_date: string;
  @IsDateString() due_date: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() is_recurring?: boolean;
  @IsOptional() @IsString() brand_id?: string;
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() account_id?: string;
  @IsOptional() @IsString() company_id?: string;
}

class UpdateAccountReceivableDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255) description?: string;
  @IsOptional() @IsString() @MaxLength(120) customer_name?: string;
  @IsOptional() @IsString() @MaxLength(20) customer_doc?: string;
  @IsOptional() @IsString() @MaxLength(50) document_number?: string;
  @IsOptional() @IsNumber() @Min(1) amount?: number;
  @IsOptional() @IsDateString() issue_date?: string;
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() brand_id?: string;
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() account_id?: string;
  @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
}

@Injectable()
export class AccountsReceivableService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateAccountReceivableDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);
    const r = await this.prisma.accountReceivable.create({
      data: {
        ...dto,
        company_id,
        amount: BigInt(dto.amount),
        issue_date: new Date(dto.issue_date),
        due_date: new Date(dto.due_date),
      },
    });
    await this.audit.log('CREATE', 'ACCOUNT_RECEIVABLE', r.id, current.id);
    return serializeBigInt(r);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.description) where.description = { contains: filters.description, mode: 'insensitive' };
    if (filters.customer_name) where.customer_name = { contains: filters.customer_name, mode: 'insensitive' };
    if (filters.status) where.status = filters.status;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.due_from || filters.due_to) {
      where.due_date = {};
      if (filters.due_from) where.due_date.gte = new Date(filters.due_from);
      if (filters.due_to) where.due_date.lte = new Date(filters.due_to);
    }

    await this.prisma.accountReceivable.updateMany({
      where: { ...where, status: PaymentStatus.PENDING, due_date: { lt: new Date() } },
      data: { status: PaymentStatus.OVERDUE },
    });

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.accountReceivable.findMany({
        where,
        orderBy: { due_date: 'asc' },
        include: {
          category: { select: { id: true, name: true, color: true } },
          brand: { select: { id: true, name: true } },
          account: { select: { id: true, code: true, name: true } },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.accountReceivable.count({ where }),
    ]);

    const totals = await this.prisma.accountReceivable.groupBy({
      by: ['status'],
      where,
      _sum: { amount: true },
    });

    return serializeBigInt({ data, total, page, per_page: 50, totals });
  }

  async findOne(id: string, current: any) {
    const r = await this.prisma.accountReceivable.findUnique({
      where: { id },
      include: { category: true, brand: true, account: true, transactions: { where: { metadeleted: false } } },
    });
    if (!r || r.metadeleted) throw new NotFoundException('Conta a receber não encontrada.');
    assertTenantAccess(r, current);
    return serializeBigInt(r);
  }

  async update(id: string, dto: UpdateAccountReceivableDto, current: any) {
    await this.findOne(id, current);
    const data: any = { ...dto };
    if (dto.amount !== undefined) data.amount = BigInt(dto.amount);
    if (dto.issue_date) data.issue_date = new Date(dto.issue_date);
    if (dto.due_date) data.due_date = new Date(dto.due_date);
    const updated = await this.prisma.accountReceivable.update({ where: { id }, data });
    await this.audit.log('UPDATE', 'ACCOUNT_RECEIVABLE', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    await this.findOne(id, current);
    await this.prisma.accountReceivable.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'ACCOUNT_RECEIVABLE', id, current.id);
    return { ok: true };
  }

  async markAsReceived(id: string, dto: { bank_account_id: string; receipt_date: string; received_amount?: number }, current: any) {
    const receivable = await this.findOne(id, current);
    const account = await this.prisma.bankAccount.findUnique({ where: { id: dto.bank_account_id } });
    if (!account || account.metadeleted) throw new BadRequestException('Conta bancária inválida.');
    assertTenantAccess(account, current);

    const received_amount = BigInt(dto.received_amount ?? Number(receivable.amount));
    const status = received_amount >= BigInt(receivable.amount) ? PaymentStatus.PAID : PaymentStatus.PARTIAL;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.accountReceivable.update({
        where: { id },
        data: {
          status,
          received_amount,
          receipt_date: new Date(dto.receipt_date),
        },
      });

      await tx.transaction.create({
        data: {
          description: `Recebimento: ${receivable.description}`,
          amount: received_amount,
          type: 'INCOME',
          date: new Date(dto.receipt_date),
          company_id: receivable.company_id,
          brand_id: receivable.brand_id,
          bank_account_id: dto.bank_account_id,
          category_id: receivable.category_id,
          account_id: receivable.account_id,
          receivable_id: id,
        },
      });

      await tx.bankAccount.update({
        where: { id: dto.bank_account_id },
        data: { current_balance: { increment: received_amount } },
      });

      return updated;
    }).then(serializeBigInt);
  }
}

@ApiTags('financial/accounts-receivable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/accounts-receivable')
export class AccountsReceivableController {
  constructor(private service: AccountsReceivableService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateAccountReceivableDto, @CurrentUser() user: any) { return this.service.create(dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) { return this.service.findAll(q, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.service.findOne(id, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccountReceivableDto, @CurrentUser() user: any) { return this.service.update(id, dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post(':id/receive')
  markAsReceived(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: any) { return this.service.markAsReceived(id, dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) { return this.service.remove(id, user); }
}

@Module({
  controllers: [AccountsReceivableController],
  providers: [AccountsReceivableService],
  exports: [AccountsReceivableService],
})
export class AccountsReceivableModule {}
