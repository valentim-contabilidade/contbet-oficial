import { Module, Injectable, NotFoundException, BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsEnum, IsBoolean, IsEmail, IsNumber, IsDateString, Min, Max } from 'class-validator';
import { ContactPersonType, Profile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../financial/tenant.helper';
import { serializeBigInt } from '../financial/money.helper';

class CreateContactDto {
  @IsEnum(ContactPersonType) person_type: ContactPersonType;
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(200) trade_name?: string;
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;

  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(20) number?: string;
  @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @IsOptional() @IsString() @MaxLength(100) neighborhood?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(10) zip_code?: string;

  @IsOptional() @IsBoolean() is_customer?: boolean;
  @IsOptional() @IsBoolean() is_supplier?: boolean;
  @IsOptional() @IsBoolean() is_employee?: boolean;
  @IsOptional() @IsBoolean() is_partner?: boolean;

  @IsOptional() @IsString() @MaxLength(120) employee_role?: string;
  @IsOptional() @IsNumber() @Min(0) employee_salary?: number;
  @IsOptional() @IsNumber() @Min(0) employee_base_salary?: number;
  @IsOptional() @IsNumber() @Min(0) employee_variable_salary?: number;
  @IsOptional() @IsDateString() employee_admission_date?: string;
  @IsOptional() @IsDateString() employee_dismissal_date?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(100) partner_share_percentage?: number;

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() company_id?: string;
  @IsOptional() @IsString() brand_id?: string;
}

class UpdateContactDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) trade_name?: string;
  @IsOptional() @IsString() @MaxLength(20) document?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(20) number?: string;
  @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @IsOptional() @IsString() @MaxLength(100) neighborhood?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(10) zip_code?: string;
  @IsOptional() @IsBoolean() is_customer?: boolean;
  @IsOptional() @IsBoolean() is_supplier?: boolean;
  @IsOptional() @IsBoolean() is_employee?: boolean;
  @IsOptional() @IsBoolean() is_partner?: boolean;
  @IsOptional() @IsString() @MaxLength(120) employee_role?: string;
  @IsOptional() @IsNumber() @Min(0) employee_salary?: number;
  @IsOptional() @IsNumber() @Min(0) employee_base_salary?: number;
  @IsOptional() @IsNumber() @Min(0) employee_variable_salary?: number;
  @IsOptional() @IsDateString() employee_admission_date?: string;
  @IsOptional() @IsDateString() employee_dismissal_date?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) partner_share_percentage?: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsString() brand_id?: string;
}

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(dto: CreateContactDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);

    const data: any = {
      ...dto,
      company_id,
    };
    if (dto.employee_salary !== undefined) data.employee_salary = BigInt(dto.employee_salary);
    if (dto.employee_base_salary !== undefined) data.employee_base_salary = BigInt(dto.employee_base_salary);
    if (dto.employee_variable_salary !== undefined) data.employee_variable_salary = BigInt(dto.employee_variable_salary);
    if (dto.employee_admission_date) data.employee_admission_date = new Date(dto.employee_admission_date);
    if (dto.employee_dismissal_date) data.employee_dismissal_date = new Date(dto.employee_dismissal_date);

    const contact = await this.prisma.contact.create({ data });
    await this.audit.log('CREATE', 'CONTACT', contact.id, current.id);
    return serializeBigInt(contact);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.name) where.name = { contains: filters.name, mode: 'insensitive' };
    if (filters.document) where.document = { contains: filters.document.replace(/\D/g, '') };
    if (filters.email) where.email = { contains: filters.email, mode: 'insensitive' };
    if (filters.is_customer === 'true') where.is_customer = true;
    if (filters.is_supplier === 'true') where.is_supplier = true;
    if (filters.is_employee === 'true') where.is_employee = true;
    if (filters.is_partner === 'true') where.is_partner = true;
    if (filters.person_type) where.person_type = filters.person_type;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const c = await this.prisma.contact.findUnique({ where: { id } });
    if (!c || c.metadeleted) throw new NotFoundException('Contato não encontrado.');
    assertTenantAccess(c, current);
    return serializeBigInt(c);
  }

  async update(id: string, dto: UpdateContactDto, current: any) {
    await this.findOne(id, current);
    const data: any = { ...dto };
    if (dto.employee_salary !== undefined) data.employee_salary = BigInt(dto.employee_salary);
    if (dto.employee_base_salary !== undefined) data.employee_base_salary = BigInt(dto.employee_base_salary);
    if (dto.employee_variable_salary !== undefined) data.employee_variable_salary = BigInt(dto.employee_variable_salary);
    if (dto.employee_admission_date) data.employee_admission_date = new Date(dto.employee_admission_date);
    if (dto.employee_dismissal_date) data.employee_dismissal_date = new Date(dto.employee_dismissal_date);
    const updated = await this.prisma.contact.update({ where: { id }, data });
    await this.audit.log('UPDATE', 'CONTACT', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    await this.findOne(id, current);
    await this.prisma.contact.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'CONTACT', id, current.id);
    return { ok: true };
  }

  /** Reúne os funcionários elegíveis para a folha do mês de uma empresa. */
  private async resolvePayrollScope(args: { company_id: string; month: number; year: number }, current: any) {
    if (current.profile === Profile.MANAGER && current.company_id !== args.company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const dueBase = new Date(Date.UTC(args.year, args.month - 1, 5));
    const monthStart = new Date(Date.UTC(args.year, args.month - 1, 1));
    const monthEnd = new Date(Date.UTC(args.year, args.month, 1));

    const employees = await this.prisma.contact.findMany({
      where: {
        company_id: args.company_id,
        is_employee: true,
        is_active: true,
        metadeleted: false,
        employee_salary: { not: null },
      },
      include: { brand: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    // Detecta duplicatas: lançamento na mesma empresa+contato dentro do mês de referência.
    const ids = employees.map(e => e.id);
    const existing = ids.length === 0 ? [] : await this.prisma.accountPayable.findMany({
      where: {
        company_id: args.company_id,
        contact_id: { in: ids },
        metadeleted: false,
        issue_date: { gte: monthStart, lt: monthEnd },
      },
      select: { id: true, contact_id: true },
    });
    const existingByContact = new Map(existing.map(x => [x.contact_id!, x.id]));
    return { employees, existingByContact, dueBase };
  }

  async previewPayroll(args: { company_id: string; month: number; year: number }, current: any) {
    const { employees, existingByContact } = await this.resolvePayrollScope(args, current);
    const items = employees.map(e => ({
      contact_id: e.id,
      name: e.name,
      document: e.document,
      role: e.employee_role,
      brand: e.brand,
      base_salary: e.employee_base_salary?.toString() ?? null,
      variable_salary: e.employee_variable_salary?.toString() ?? null,
      total_salary: (e.employee_salary ?? 0n).toString(),
      already_exists: existingByContact.has(e.id),
      existing_payable_id: existingByContact.get(e.id) ?? null,
    }));
    const total = items.filter(i => !i.already_exists).reduce((s, i) => s + BigInt(i.total_salary), 0n);
    return serializeBigInt({
      employees: items,
      to_create_count: items.filter(i => !i.already_exists).length,
      to_skip_count: items.filter(i => i.already_exists).length,
      total_amount: total.toString(),
      month: args.month,
      year: args.year,
    });
  }

  /**
   * Gera contas a pagar mensais para todos os funcionários ativos da empresa.
   * Pode ser chamado manualmente ou via cron mensal.
   */
  async generatePayrollPayables(args: { company_id: string; month: number; year: number; nature_id?: string; due_day?: number }, current: any) {
    const due_day = Math.max(1, Math.min(28, args.due_day ?? 5));
    const { employees, existingByContact } = await this.resolvePayrollScope({
      company_id: args.company_id, month: args.month, year: args.year,
    }, current);

    if (args.nature_id) {
      const nature = await this.prisma.financialNature.findUnique({ where: { id: args.nature_id } });
      if (!nature || nature.metadeleted) throw new BadRequestException('Natureza inválida.');
      if (nature.company_id !== args.company_id) throw new BadRequestException('Natureza não pertence à empresa.');
      if (nature.type !== 'DESPESA') throw new BadRequestException('Use uma natureza de DESPESA para a folha.');
      if (!nature.is_active) throw new BadRequestException('Natureza inativa.');
    }

    const issue_date = new Date(Date.UTC(args.year, args.month - 1, 1));
    const due_date = new Date(Date.UTC(args.year, args.month - 1, due_day));

    let created = 0;
    let skipped = 0;
    for (const emp of employees) {
      if (!emp.employee_salary) continue;
      if (existingByContact.has(emp.id)) { skipped++; continue; }

      await this.prisma.accountPayable.create({
        data: {
          description: `Salário ${emp.name} - ${String(args.month).padStart(2, '0')}/${args.year}`,
          supplier_name: emp.name,
          supplier_doc: emp.document,
          amount: emp.employee_salary,
          issue_date,
          due_date,
          company_id: args.company_id,
          contact_id: emp.id,
          brand_id: emp.brand_id ?? undefined,
          nature_id: args.nature_id,
          source: 'PAYROLL' as any,
          notes: 'Gerado automaticamente pela folha de pagamento.',
        },
      });
      created++;
    }
    await this.audit.log('GENERATE_PAYROLL', 'CONTACT', undefined, current.id, { ...args, created, skipped });
    return { created, skipped, month: args.month, year: args.year };
  }
}

@ApiTags('contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private service: ContactsService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateContactDto, @CurrentUser() user: any) {
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
  update(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('payroll-preview')
  previewPayroll(@Body() dto: { company_id: string; month: number; year: number }, @CurrentUser() user: any) {
    return this.service.previewPayroll(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('generate-payroll')
  generatePayroll(@Body() dto: { company_id: string; month: number; year: number; nature_id?: string; due_day?: number }, @CurrentUser() user: any) {
    return this.service.generatePayrollPayables(dto, user);
  }
}

@Module({
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
