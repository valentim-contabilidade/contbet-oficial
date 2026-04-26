import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsBoolean, Matches } from 'class-validator';
import { Profile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { serializeBigInt } from '../financial/money.helper';

class CreateBankDto {
  @IsString() @Matches(/^\d{3}$/, { message: 'Código deve ter 3 dígitos (COMPE)' }) code: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(8) ispb?: string;
}

class UpdateBankDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(8) ispb?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Injectable()
export class BanksService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateBankDto, current: any) {
    const exists = await this.prisma.bank.findUnique({ where: { code: dto.code } });
    if (exists) throw new BadRequestException('Banco com este código já cadastrado.');
    const bank = await this.prisma.bank.create({ data: dto });
    await this.audit.log('CREATE', 'BANK', bank.id, current.id);
    return serializeBigInt(bank);
  }

  async findAll(filters: any) {
    const where: any = { metadeleted: false };
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.code) where.code = { contains: filters.code };
    if (filters.is_active === 'true') where.is_active = true;

    const data = await this.prisma.bank.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return serializeBigInt({ data, total: data.length, page: 1, per_page: data.length });
  }

  async findOne(id: string) {
    const b = await this.prisma.bank.findUnique({ where: { id } });
    if (!b || b.metadeleted) throw new NotFoundException('Banco não encontrado.');
    return serializeBigInt(b);
  }

  async update(id: string, dto: UpdateBankDto, current: any) {
    await this.findOne(id);
    const updated = await this.prisma.bank.update({ where: { id }, data: dto });
    await this.audit.log('UPDATE', 'BANK', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    await this.findOne(id);
    const inUse = await this.prisma.bankAccount.count({ where: { bank_id: id, metadeleted: false } });
    if (inUse > 0) throw new BadRequestException('Banco em uso por contas bancárias.');
    await this.prisma.bank.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'BANK', id, current.id);
    return { ok: true };
  }
}

@ApiTags('banks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('banks')
export class BanksController {
  constructor(private service: BanksService) {}

  // Listagem disponível para todos os perfis autenticados (precisa para preencher selects)
  @Get()
  findAll(@Query() q: any) {
    return this.service.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Criação/edição/deleção: apenas ADMIN (catálogo é global do sistema)
  @Profiles(Profile.ADMIN)
  @Post()
  create(@Body() dto: CreateBankDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Profiles(Profile.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBankDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

@Module({
  controllers: [BanksController],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}
