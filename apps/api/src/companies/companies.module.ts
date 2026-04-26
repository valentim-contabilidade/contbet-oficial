import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, Matches, Length, IsEnum } from 'class-validator';
import { Profile, TaxRegime } from '@prisma/client';
import { pisCofinsDefaultsForRegime } from '../tax/regime-defaults';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';

// ---------- DTOs ----------
class CreateCompanyDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name: string;

  @IsString()
  @Matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/, { message: 'CNPJ inválido' })
  cnpj: string;

  @IsOptional() @IsString() @MaxLength(255)
  address?: string;

  @IsString() @MinLength(2) @MaxLength(80)
  city: string;

  @IsString() @Length(2, 2)
  state: string;

  @IsOptional() @IsString()
  logo?: string; // base64 data URL

  @IsOptional() @IsEnum(TaxRegime)
  tax_regime?: TaxRegime;
}

class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(255)
  address?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  city?: string;

  @IsOptional() @IsString() @Length(2, 2)
  state?: string;

  @IsOptional() @IsString()
  logo?: string;

  @IsOptional() @IsEnum(TaxRegime)
  tax_regime?: TaxRegime;
}

// ---------- Service ----------
@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private validateLogo(logo?: string) {
    if (!logo) return;
    if (!logo.startsWith('data:image/')) throw new BadRequestException('Logo deve ser uma imagem em base64.');
    // base64 length aproximada (256x256 png ≈ <200KB → base64 ~270KB)
    if (logo.length > 400_000) throw new BadRequestException('Logo excede o tamanho máximo (256x256).');
  }

  async create(dto: CreateCompanyDto, userId: string) {
    this.validateLogo(dto.logo);
    const cnpj = dto.cnpj.replace(/\D/g, '');
    const exists = await this.prisma.company.findUnique({ where: { cnpj } });
    if (exists) throw new BadRequestException('CNPJ já cadastrado.');

    const company = await this.prisma.company.create({
      data: { ...dto, cnpj, state: dto.state.toUpperCase() },
    });
    await this.audit.log('CREATE', 'COMPANY', company.id, userId);
    return company;
  }

  async findAll(filters: { name?: string; cnpj?: string; state?: string; page?: number }) {
    const page = Math.max(1, filters.page ?? 1);
    const where = {
      metadeleted: false,
      ...(filters.name && { name: { contains: filters.name, mode: 'insensitive' as const } }),
      ...(filters.cnpj && { cnpj: { contains: filters.cnpj.replace(/\D/g, '') } }),
      ...(filters.state && { state: filters.state.toUpperCase() }),
    };
    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.company.count({ where }),
    ]);
    return { data, total, page, per_page: 50 };
  }

  async findOne(id: string) {
    const c = await this.prisma.company.findUnique({ where: { id } });
    if (!c || c.metadeleted) throw new NotFoundException('Empresa não encontrada.');
    return c;
  }

  async update(id: string, dto: UpdateCompanyDto, userId: string) {
    this.validateLogo(dto.logo);
    await this.findOne(id);
    const updated = await this.prisma.company.update({
      where: { id },
      data: { ...dto, ...(dto.state && { state: dto.state.toUpperCase() }) },
    });
    if (dto.tax_regime) {
      // Mantém a configuração tributária da empresa em sincronia, incluindo PIS/COFINS.
      const cfg = await this.prisma.companyTaxConfig.findUnique({ where: { company_id: id } });
      if (cfg) {
        const defaults = pisCofinsDefaultsForRegime(dto.tax_regime);
        const data: any = { tax_regime: dto.tax_regime };
        if (defaults) {
          data.pis_cofins_regime = defaults.pis_cofins_regime;
          data.pis_rate = defaults.pis_rate;
          data.cofins_rate = defaults.cofins_rate;
        }
        await this.prisma.companyTaxConfig.update({ where: { id: cfg.id }, data });
      }
    }
    await this.audit.log('UPDATE', 'COMPANY', id, userId);
    return updated;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.company.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'COMPANY', id, userId);
    return { ok: true };
  }
}

// ---------- Controller ----------
@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private service: CompaniesService) {}

  @Profiles(Profile.ADMIN)
  @Post()
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: any) {
    return this.service.create(dto, user.id);
  }

  @Get()
  findAll(@Query() q: any) {
    return this.service.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Profiles(Profile.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user.id);
  }

  @Profiles(Profile.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user.id);
  }
}

// ---------- Module ----------
@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
