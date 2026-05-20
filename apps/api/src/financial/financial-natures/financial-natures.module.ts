import {
  Module, Injectable, NotFoundException, BadRequestException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsBoolean, IsEnum, IsInt, MaxLength, MinLength, Min,
} from 'class-validator';
import { Profile, NatureType, DreSection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';
import {
  DEFAULT_NATURES,
  seedDefaultNaturesForCompany,
  migrateLei14790ForCompany,
} from './default-natures';

class CreateNatureDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsEnum(NatureType) type: NatureType;
  @IsEnum(DreSection) dre_section: DreSection;
  @IsOptional() @IsInt() @Min(0) dre_order?: number;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(20) accounting_code?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsString() company_id?: string;
}

class UpdateNatureDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(NatureType) type?: NatureType;
  @IsOptional() @IsEnum(DreSection) dre_section?: DreSection;
  @IsOptional() @IsInt() @Min(0) dre_order?: number;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(20) accounting_code?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

class SeedDto {
  @IsString() company_id: string;
}

@Injectable()
export class FinancialNaturesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    where.metadeleted = false;
    if (filters.type) where.type = filters.type;
    if (filters.dre_section) where.dre_section = filters.dre_section;
    if (filters.is_active !== undefined) {
      where.is_active = filters.is_active === 'true' || filters.is_active === true;
    }
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const data = await this.prisma.financialNature.findMany({
      where,
      orderBy: [{ dre_section: 'asc' }, { dre_order: 'asc' }, { name: 'asc' }],
    });
    return serializeBigInt({ data, total: data.length });
  }

  async findOne(id: string, current: any) {
    const n = await this.prisma.financialNature.findUnique({ where: { id } });
    if (!n || n.metadeleted) throw new NotFoundException('Natureza não encontrada.');
    assertTenantAccess(n, current);
    return serializeBigInt(n);
  }

  async create(dto: CreateNatureDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);

    this.validateDreSection(dto.type, dto.dre_section);

    const data: any = {
      name: dto.name,
      type: dto.type,
      dre_section: dto.dre_section,
      dre_order: dto.dre_order ?? 0,
      company_id,
      is_default: false,
    };
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.accounting_code !== undefined) data.accounting_code = dto.accounting_code;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;

    const nature = await this.prisma.financialNature.create({ data });
    await this.audit.log('CREATE', 'FINANCIAL_NATURE', nature.id, current.id);
    return serializeBigInt(nature);
  }

  async update(id: string, dto: UpdateNatureDto, current: any) {
    const existing = await this.findOne(id, current);

    if (dto.type || dto.dre_section) {
      this.validateDreSection(
        dto.type ?? existing.type,
        dto.dre_section ?? existing.dre_section,
      );
    }

    const updated = await this.prisma.financialNature.update({
      where: { id },
      data: dto as any,
    });
    await this.audit.log('UPDATE', 'FINANCIAL_NATURE', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    const existing = await this.findOne(id, current);

    const [payablesCount, receivablesCount] = await Promise.all([
      this.prisma.accountPayable.count({ where: { nature_id: id, metadeleted: false } }),
      this.prisma.accountReceivable.count({ where: { nature_id: id, metadeleted: false } }),
    ]);
    const totalUsage = payablesCount + receivablesCount;

    if (totalUsage > 0) {
      throw new BadRequestException(
        `Esta natureza está vinculada a ${totalUsage} lançamento(s). Desative-a em vez de excluir.`,
      );
    }

    await this.prisma.financialNature.update({
      where: { id },
      data: { metadeleted: true, is_active: false },
    });
    await this.audit.log('DELETE', 'FINANCIAL_NATURE', id, current.id);
    return { ok: true };
  }

  /** Cria as 16 naturezas padrão para uma empresa. Idempotente. */
  async seedDefaults(dto: SeedDto, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    const result = await seedDefaultNaturesForCompany(this.prisma, dto.company_id);

    // FIX: audit.log espera string | undefined no entity_id, não null
    await this.audit.log('SEED', 'FINANCIAL_NATURE', undefined, current.id, result);

    return {
      ...result,
      total_default: DEFAULT_NATURES.length,
      message: `${result.created} natureza(s) criada(s), ${result.skipped} já existiam.`,
    };
  }

  /**
   * Migra empresas legadas para o desdobramento completo das destinações da
   * Lei 14.790 (Manual SPA/MF 08/05/2026): renomeia a natureza antiga para
   * "Lei 14.790 — DARF Conta Única do Tesouro" preservando ID, cria as 3
   * novas (Entidades Privadas, Educação, Direitos de Imagem), reordena
   * PIS/COFINS e ISS, e sincroniza o plano de contas com sub-contas DARF
   * e grupo de repasses não-DARF.
   */
  async migrateLei14790(dto: SeedDto, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== dto.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }

    const company = await this.prisma.company.findUnique({ where: { id: dto.company_id } });
    if (!company) throw new BadRequestException('Empresa inválida.');

    const result = await migrateLei14790ForCompany(this.prisma, dto.company_id);
    await this.audit.log('MIGRATE_LEI14790', 'FINANCIAL_NATURE', undefined, current.id, result);

    const parts: string[] = [];
    if (result.renamed_legacy_nature) parts.push('natureza antiga renomeada para "DARF Conta Única do Tesouro"');
    if (result.natures_created > 0) parts.push(`${result.natures_created} natureza(s) Lei 14.790 criada(s)`);
    if (result.natures_renumbered > 0) parts.push(`${result.natures_renumbered} natureza(s) reordenada(s)`);
    if (result.chart_accounts_created > 0) parts.push(`${result.chart_accounts_created} conta(s) contábil(is) criada(s)`);
    return {
      ...result,
      message: parts.length > 0
        ? parts.join('; ') + '.'
        : 'Nada a migrar — empresa já está atualizada.',
    };
  }

  private validateDreSection(type: NatureType, section: DreSection) {
    const receitaSections: DreSection[] = [
      DreSection.RECEITA_OPERACIONAL,
      DreSection.RECEITA_FINANCEIRA,
    ];
    const despesaSections: DreSection[] = [
      DreSection.DEDUCAO_RECEITA,
      DreSection.CUSTO_OPERACIONAL,
      DreSection.DESPESA_OPERACIONAL,
      DreSection.DESPESA_NAO_OPERACIONAL,
      DreSection.DESPESA_FINANCEIRA,
      DreSection.IMPOSTO_LUCRO,
    ];

    if (type === NatureType.RECEITA && !receitaSections.includes(section)) {
      throw new BadRequestException(
        'Naturezas do tipo RECEITA só podem estar em seções de receita (Receita Operacional ou Receita Financeira).',
      );
    }
    if (type === NatureType.DESPESA && !despesaSections.includes(section)) {
      throw new BadRequestException(
        'Naturezas do tipo DESPESA só podem estar em seções de despesa, custo, dedução ou imposto.',
      );
    }
  }
}

@ApiTags('financial/natures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/natures')
export class FinancialNaturesController {
  constructor(private service: FinancialNaturesService) {}

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
  @Post()
  create(@Body() dto: CreateNatureDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNatureDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('seed-defaults')
  seed(@Body() dto: SeedDto, @CurrentUser() user: any) {
    return this.service.seedDefaults(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('migrate-lei14790')
  migrateLei14790(@Body() dto: SeedDto, @CurrentUser() user: any) {
    return this.service.migrateLei14790(dto, user);
  }
}

@Module({
  controllers: [FinancialNaturesController],
  providers: [FinancialNaturesService],
  exports: [FinancialNaturesService],
})
export class FinancialNaturesModule {}
