import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean, Matches } from 'class-validator';
import { AccountType, Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';

class CreateChartOfAccountDto {
  @IsString() @Matches(/^[\d.]+$/, { message: 'Código deve conter apenas números e pontos' })
  code: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(AccountType) type: AccountType;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() parent_id?: string;
  @IsOptional() @IsString() company_id?: string;
}

class UpdateChartOfAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateChartOfAccountDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);

    const exists = await this.prisma.chartOfAccount.findFirst({
      where: { company_id, code: dto.code, metadeleted: false },
    });
    if (exists) throw new BadRequestException('Código já cadastrado nesta empresa.');

    if (dto.parent_id) {
      const parent = await this.prisma.chartOfAccount.findUnique({ where: { id: dto.parent_id } });
      if (!parent || parent.metadeleted || parent.company_id !== company_id) {
        throw new BadRequestException('Conta pai inválida.');
      }
    }

    const account = await this.prisma.chartOfAccount.create({
      data: { ...dto, company_id },
    });
    await this.audit.log('CREATE', 'CHART_OF_ACCOUNT', account.id, current.id);
    return serializeBigInt(account);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.code) where.code = { contains: filters.code };
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.type) where.type = filters.type;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.chartOfAccount.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.chartOfAccount.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const account = await this.prisma.chartOfAccount.findUnique({ where: { id } });
    if (!account || account.metadeleted) throw new NotFoundException('Conta não encontrada.');
    assertTenantAccess(account, current);
    return serializeBigInt(account);
  }

  async update(id: string, dto: UpdateChartOfAccountDto, current: any) {
    await this.findOne(id, current);
    const updated = await this.prisma.chartOfAccount.update({ where: { id }, data: dto });
    await this.audit.log('UPDATE', 'CHART_OF_ACCOUNT', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    await this.findOne(id, current);
    // Não permite deletar se tem filhas ou está em uso
    const hasChildren = await this.prisma.chartOfAccount.count({ where: { parent_id: id, metadeleted: false } });
    if (hasChildren > 0) throw new BadRequestException('Não é possível excluir: existem subcontas vinculadas.');
    await this.prisma.chartOfAccount.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'CHART_OF_ACCOUNT', id, current.id);
    return { ok: true };
  }
}

@ApiTags('financial/chart-of-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/chart-of-accounts')
export class ChartOfAccountsController {
  constructor(private service: ChartOfAccountsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateChartOfAccountDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChartOfAccountDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

@Module({
  controllers: [ChartOfAccountsController],
  providers: [ChartOfAccountsService],
  exports: [ChartOfAccountsService],
})
export class ChartOfAccountsModule {}
