import { Module, Injectable, NotFoundException, BadRequestException, ForbiddenException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsEmail, IsOptional, MinLength, MaxLength, IsEnum, IsUUID } from 'class-validator';
import { Profile, Status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @MinLength(3) @MaxLength(40) username: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsEnum(Profile) profile: Profile;
  @IsOptional() @IsString() company_id?: string;
  @IsOptional() @IsString() brand_id?: string;
  @IsOptional() @IsEnum(Status) status?: Status;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(Profile) profile?: Profile;
  @IsOptional() @IsString() company_id?: string | null;
  @IsOptional() @IsString() brand_id?: string | null;
  @IsOptional() @IsEnum(Status) status?: Status;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private auth: AuthService,
  ) {}

  private assertCanCreateProfile(currentProfile: Profile, target: Profile) {
    if (currentProfile === Profile.ADMIN) return;
    if (currentProfile === Profile.MANAGER && target === Profile.OWNER) return;
    throw new ForbiddenException('Você não pode criar usuários deste perfil.');
  }

  async create(dto: CreateUserDto, current: { id: string; profile: Profile; company_id: string | null }) {
    this.assertCanCreateProfile(current.profile, dto.profile);

    if (dto.profile !== Profile.ADMIN && !dto.company_id) {
      throw new BadRequestException('Manager e Owner devem estar vinculados a uma empresa.');
    }
    if (dto.profile === Profile.OWNER && !dto.brand_id) {
      throw new BadRequestException('Owner deve estar vinculado a uma marca.');
    }
    if (current.profile === Profile.MANAGER && dto.company_id !== current.company_id) {
      throw new ForbiddenException('Você só pode criar usuários da sua empresa.');
    }

    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new BadRequestException('Username já existe.');

    const password_hash = await this.auth.hashPassword(dto.password);
    const { password, ...rest } = dto;

    const user = await this.prisma.user.create({
      data: {
        ...rest,
        password_hash,
        company_id: dto.profile === Profile.ADMIN ? null : dto.company_id,
        brand_id: dto.profile === Profile.OWNER ? dto.brand_id : null,
        status: dto.status ?? Status.ACTIVE,
      },
    });
    await this.audit.log('CREATE', 'USER', user.id, current.id);
    const { password_hash: _, ...safe } = user;
    return safe;
  }

  async findAll(filters: any, current: { profile: Profile; company_id: string | null }) {
    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const where: any = { metadeleted: false };
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.username) where.username = { contains: filters.username.toLowerCase() };
    if (filters.profile) where.profile = filters.profile;

    if (current.profile === Profile.MANAGER) {
      where.company_id = current.company_id;
    }
    if (current.profile === Profile.OWNER) {
      throw new ForbiddenException();
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: data.map(({ password_hash, ...u }) => u),
      total, page, per_page: 50,
    };
  }

  async findOne(id: string, current: { profile: Profile; company_id: string | null }) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || u.metadeleted) throw new NotFoundException('Usuário não encontrado.');
    if (current.profile === Profile.MANAGER && u.company_id !== current.company_id) {
      throw new ForbiddenException();
    }
    const { password_hash, ...safe } = u;
    return safe;
  }

  async update(id: string, dto: UpdateUserDto, current: { id: string; profile: Profile; company_id: string | null }) {
    const u = await this.findOne(id, current);
    if (dto.profile && dto.profile !== u.profile) {
      this.assertCanCreateProfile(current.profile, dto.profile);
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
    });
    await this.audit.log('UPDATE', 'USER', id, current.id);
    const { password_hash, ...safe } = updated;
    return safe;
  }

  async remove(id: string, current: { id: string; profile: Profile; company_id: string | null }) {
    if (id === current.id) throw new BadRequestException('Você não pode excluir a si mesmo.');
    await this.findOne(id, current);
    await this.prisma.user.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'USER', id, current.id);
    return { ok: true };
  }
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: any) {
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
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}