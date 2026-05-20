import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean, IsNumber, Min } from 'class-validator';
import { BankAccountType, Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';

class CreateBankAccountDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(BankAccountType) type: BankAccountType;
  @IsOptional() @IsString() @MaxLength(80) bank_name?: string;
  @IsOptional() @IsString() @MaxLength(10) bank_code?: string;
  @IsOptional() @IsString() @MaxLength(20) agency?: string;
  @IsOptional() @IsString() @MaxLength(30) account_number?: string;
  @IsOptional() @IsNumber() initial_balance?: number; // em centavos
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() company_id?: string;
  @IsOptional() @IsBoolean() is_player_wallet?: boolean;
  @IsOptional() @IsNumber() fee_per_credit?: number;
  @IsOptional() @IsNumber() fee_per_debit?: number;
}

class UpdateBankAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) bank_name?: string;
  @IsOptional() @IsString() @MaxLength(10) bank_code?: string;
  @IsOptional() @IsString() @MaxLength(20) agency?: string;
  @IsOptional() @IsString() @MaxLength(30) account_number?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsBoolean() is_player_wallet?: boolean;
  @IsOptional() @IsNumber() fee_per_credit?: number;
  @IsOptional() @IsNumber() fee_per_debit?: number;
}

@Injectable()
export class BankAccountsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateBankAccountDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);
    const initial = BigInt(dto.initial_balance ?? 0);
    const { fee_per_credit, fee_per_debit, initial_balance: _ib, ...rest } = dto as any;
    const account = await this.prisma.bankAccount.create({
      data: {
        ...rest,
        company_id,
        initial_balance: initial,
        current_balance: initial,
        ...(fee_per_credit !== undefined ? { fee_per_credit: BigInt(fee_per_credit) } : {}),
        ...(fee_per_debit !== undefined ? { fee_per_debit: BigInt(fee_per_debit) } : {}),
      },
    });
    await this.audit.log('CREATE', 'BANK_ACCOUNT', account.id, current.id);
    return serializeBigInt(account);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.type) where.type = filters.type;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.bankAccount.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          bank_connection: {
            select: { id: true, institution_name: true, institution_logo: true, status: true, last_sync_at: true },
          },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.bankAccount.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account || account.metadeleted) throw new NotFoundException('Conta não encontrada.');
    assertTenantAccess(account, current);
    return serializeBigInt(account);
  }

  async update(id: string, dto: UpdateBankAccountDto, current: any) {
    await this.findOne(id, current);
    const { fee_per_credit, fee_per_debit, ...rest } = dto as any;
    const data: any = { ...rest };
    if (fee_per_credit !== undefined) data.fee_per_credit = BigInt(fee_per_credit);
    if (fee_per_debit !== undefined) data.fee_per_debit = BigInt(fee_per_debit);
    const updated = await this.prisma.bankAccount.update({ where: { id }, data });
    await this.audit.log('UPDATE', 'BANK_ACCOUNT', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    await this.findOne(id, current);
    const txCount = await this.prisma.transaction.count({ where: { bank_account_id: id, metadeleted: false } });
    if (txCount > 0) throw new BadRequestException('Não é possível excluir: existem lançamentos vinculados.');
    await this.prisma.bankAccount.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'BANK_ACCOUNT', id, current.id);
    return { ok: true };
  }

  async recalculateBalance(id: string) {
    const txs = await this.prisma.transaction.findMany({
      where: { bank_account_id: id, metadeleted: false },
    });
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return;
    let balance = account.initial_balance;
    for (const tx of txs) {
      if (tx.type === 'INCOME') balance += tx.amount;
      else if (tx.type === 'EXPENSE') balance -= tx.amount;
      else if (tx.type === 'TRANSFER') balance -= tx.amount; // saída da conta origem
    }
    // Soma transferências recebidas
    const received = await this.prisma.transaction.findMany({
      where: { destination_account_id: id, metadeleted: false, type: 'TRANSFER' },
    });
    for (const tx of received) balance += tx.amount;
    await this.prisma.bankAccount.update({ where: { id }, data: { current_balance: balance } });
  }
}

@ApiTags('financial/bank-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/bank-accounts')
export class BankAccountsController {
  constructor(private service: BankAccountsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateBankAccountDto, @CurrentUser() user: any) { return this.service.create(dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) { return this.service.findAll(q, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.service.findOne(id, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBankAccountDto, @CurrentUser() user: any) { return this.service.update(id, dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) { return this.service.remove(id, user); }
}

@Module({
  controllers: [BankAccountsController],
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
