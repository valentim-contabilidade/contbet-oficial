import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean, Matches } from 'class-validator';
import { CategoryType, Profile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';

class CreateFinancialCategoryDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEnum(CategoryType) type: CategoryType;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Cor deve ser hex (#RRGGBB)' }) color?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() company_id?: string;
  /** Natureza contábil padrão para auto-preencher quando esta categoria for usada num lançamento. */
  @IsOptional() @IsString() default_nature_id?: string;
}

class UpdateFinancialCategoryDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsString() default_nature_id?: string;
}

@Injectable()
export class FinancialCategoriesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /**
   * Valida que a natureza padrão sugerida pertence à mesma empresa
   * e tem type compatível com o tipo da categoria (RECEITA/DESPESA).
   */
  private async validateDefaultNature(natureId: string | undefined | null, companyId: string, categoryType: CategoryType) {
    if (!natureId) return;
    const nature = await this.prisma.financialNature.findUnique({ where: { id: natureId } });
    if (!nature || nature.metadeleted) {
      throw new BadRequestException('Natureza padrão inválida.');
    }
    if (nature.company_id !== companyId) {
      throw new BadRequestException('A natureza padrão precisa ser da mesma empresa.');
    }
    // CategoryType.INCOME → RECEITA / CategoryType.EXPENSE → DESPESA
    const expectedNatureType = categoryType === CategoryType.INCOME ? 'RECEITA' : 'DESPESA';
    if (nature.type !== expectedNatureType) {
      throw new BadRequestException(`Natureza padrão deve ser do tipo ${expectedNatureType} para casar com a categoria.`);
    }
  }

  async create(dto: CreateFinancialCategoryDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);
    await this.validateDefaultNature(dto.default_nature_id, company_id, dto.type);
    const { company_id: _ignored, ...rest } = dto as any;
    const cat = await this.prisma.financialCategory.create({
      data: { ...rest, company_id },
      include: { default_nature: { select: { id: true, name: true, dre_section: true, type: true } } },
    });
    await this.audit.log('CREATE', 'FINANCIAL_CATEGORY', cat.id, current.id);
    return serializeBigInt(cat);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.type) where.type = filters.type;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.financialCategory.findMany({
        where,
        orderBy: { name: 'asc' },
        include: { default_nature: { select: { id: true, name: true, dre_section: true, type: true } } },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.financialCategory.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const cat = await this.prisma.financialCategory.findUnique({
      where: { id },
      include: { default_nature: { select: { id: true, name: true, dre_section: true, type: true } } },
    });
    if (!cat || cat.metadeleted) throw new NotFoundException('Categoria não encontrada.');
    assertTenantAccess(cat, current);
    return serializeBigInt(cat);
  }

  async update(id: string, dto: UpdateFinancialCategoryDto, current: any) {
    const existing = await this.prisma.financialCategory.findUnique({ where: { id } });
    if (!existing || existing.metadeleted) throw new NotFoundException('Categoria não encontrada.');
    assertTenantAccess(existing, current);
    if (dto.default_nature_id !== undefined) {
      await this.validateDefaultNature(dto.default_nature_id || null, existing.company_id, existing.type);
    }
    const data: any = { ...dto };
    if (dto.default_nature_id === '') data.default_nature_id = null; // permite "limpar"
    const updated = await this.prisma.financialCategory.update({
      where: { id }, data,
      include: { default_nature: { select: { id: true, name: true, dre_section: true, type: true } } },
    });
    await this.audit.log('UPDATE', 'FINANCIAL_CATEGORY', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    await this.findOne(id, current);
    await this.prisma.financialCategory.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'FINANCIAL_CATEGORY', id, current.id);
    return { ok: true };
  }
}

@ApiTags('financial/categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/categories')
export class FinancialCategoriesController {
  constructor(private service: FinancialCategoriesService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateFinancialCategoryDto, @CurrentUser() user: any) { return this.service.create(dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) { return this.service.findAll(q, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) { return this.service.findOne(id, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFinancialCategoryDto, @CurrentUser() user: any) { return this.service.update(id, dto, user); }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) { return this.service.remove(id, user); }
}

@Module({
  controllers: [FinancialCategoriesController],
  providers: [FinancialCategoriesService],
  exports: [FinancialCategoriesService],
})
export class FinancialCategoriesModule {}
