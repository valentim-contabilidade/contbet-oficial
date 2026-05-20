import { Module, Injectable, NotFoundException, BadRequestException, ForbiddenException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, Matches } from 'class-validator';
import { Profile, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';

class CreateBrandDto {
  @IsString() @MinLength(3) @MaxLength(80) name: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, { message: 'Domínio inválido' }) domain?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsString() company_id: string;
  @IsOptional() @IsEnum(Status) status?: Status;
}

class UpdateBrandDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(80) name?: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsEnum(Status) status?: Status;
}

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async assertCanWrite(_brand: { company_id: string }, current: { profile: Profile; company_id: string | null }) {
    if (current.profile === Profile.ADMIN) return;
    throw new ForbiddenException('Apenas administradores podem alterar marcas.');
  }

  async create(dto: CreateBrandDto, current: any) {
    if (current.profile !== Profile.ADMIN) {
      throw new ForbiddenException('Apenas administradores podem cadastrar marcas.');
    }

    const brand = await this.prisma.brand.create({ data: { ...dto, status: dto.status ?? Status.ACTIVE } });
    await this.audit.log('CREATE', 'BRAND', brand.id, current.id);
    return brand;
  }

  async findAll(filters: any, current: any) {
    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const where: any = { metadeleted: false };
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.domain) where.domain = { contains: filters.domain };
    if (filters.company_id) where.company_id = filters.company_id;

    if (current.profile === Profile.MANAGER) where.company_id = current.company_id;
    if (current.profile === Profile.OWNER) {
      // OWNER: usa lista N:N (brand_ids do JWT) ou cai pro brand_id legado
      const brandIds = (current.brand_ids && current.brand_ids.length > 0)
        ? current.brand_ids
        : (current.brand_id ? [current.brand_id] : []);
      where.id = brandIds.length === 0 ? '__none__' : { in: brandIds };
    }

    const [data, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: { company: { select: { id: true, name: true } } },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return { data, total, page, per_page: 50 };
  }

  async findOne(id: string, current: any) {
    const b = await this.prisma.brand.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!b || b.metadeleted) throw new NotFoundException('Marca não encontrada.');
    if (current.profile === Profile.MANAGER && b.company_id !== current.company_id) throw new ForbiddenException();
    if (current.profile === Profile.OWNER && b.id !== current.brand_id) throw new ForbiddenException();
    return b;
  }

  async update(id: string, dto: UpdateBrandDto, current: any) {
    const b = await this.findOne(id, current);
    await this.assertCanWrite(b, current);
    const updated = await this.prisma.brand.update({ where: { id }, data: dto });
    await this.audit.log('UPDATE', 'BRAND', id, current.id);
    return updated;
  }

  async remove(id: string, current: any) {
    const b = await this.findOne(id, current);
    await this.assertCanWrite(b, current);
    await this.prisma.brand.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'BRAND', id, current.id);
    return { ok: true };
  }
}

@ApiTags('brands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('brands')
export class BrandsController {
  constructor(private service: BrandsService) {}

  @Profiles(Profile.ADMIN)
  @Post()
  create(@Body() dto: CreateBrandDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get()
  findAll(@Query() q: any, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Profiles(Profile.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

@Module({
  controllers: [BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
