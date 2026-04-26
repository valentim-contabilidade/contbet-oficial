import {
  Module, Injectable, NotFoundException, BadRequestException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsNumber, IsDateString, MaxLength, Min, MinLength, IsBoolean,
} from 'class-validator';
import { Profile, PaymentStatus, TransactionType, NatureType, PayableSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';
import { AccountingModule } from '../../accounting/accounting.module';
import { JournalPostingService } from '../../accounting/journal-posting.service';

class CreateAccountPayableDto {
  @IsString() @MinLength(2) @MaxLength(300) description: string;
  @IsOptional() @IsString() @MaxLength(200) supplier_name?: string;
  @IsOptional() @IsString() @MaxLength(20) supplier_doc?: string;
  @IsOptional() @IsString() contact_id?: string;
  @IsOptional() @IsString() @MaxLength(80) document_number?: string;
  @IsNumber() @Min(1) amount: number;
  @IsDateString() issue_date: string;
  @IsDateString() due_date: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() company_id?: string;
  @IsOptional() @IsString() brand_id?: string;
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() nature_id?: string;
  @IsOptional() @IsString() account_id?: string;
  @IsOptional() @IsBoolean() is_recurring?: boolean;
  @IsOptional() @IsBoolean() is_deductible_expense?: boolean;
  @IsOptional() @IsBoolean() generates_pis_cofins_credit?: boolean;
  /** Quando true, aceita criar mesmo havendo duplicata (registra como duplicate_of). */
  @IsOptional() @IsBoolean() force_duplicate?: boolean;
}

class UpdateAccountPayableDto {
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MaxLength(200) supplier_name?: string;
  @IsOptional() @IsString() @MaxLength(20) supplier_doc?: string;
  @IsOptional() @IsString() contact_id?: string;
  @IsOptional() @IsString() @MaxLength(80) document_number?: string;
  @IsOptional() @IsNumber() @Min(1) amount?: number;
  @IsOptional() @IsDateString() issue_date?: string;
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() brand_id?: string;
  @IsOptional() @IsString() category_id?: string;
  @IsOptional() @IsString() nature_id?: string;
  @IsOptional() @IsString() account_id?: string;
}

class PayDto {
  @IsString() bank_account_id: string;
  @IsDateString() payment_date: string;
  @IsOptional() @IsNumber() @Min(1) paid_amount?: number;
}

@Injectable()
export class AccountsPayableService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private posting: JournalPostingService,
  ) {}

  private async safePost(id: string) {
    try { await this.posting.postPayablePaid(id); }
    catch (e: any) { console.warn(`[Payable posting] ${id}: ${e?.message ?? e}`); }
  }

  /**
   * Resolve dados do contato (se fornecido) e popula supplier_name/supplier_doc.
   */
  private async resolveContact(contactId: string | undefined, companyId: string) {
    if (!contactId) return { contact_id: undefined, supplier_name: undefined, supplier_doc: undefined };
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.metadeleted) {
      throw new BadRequestException('Contato não encontrado.');
    }
    if (contact.company_id !== companyId) {
      throw new BadRequestException('Contato não pertence à empresa selecionada.');
    }
    if (!contact.is_supplier) {
      throw new BadRequestException('Contato selecionado não é um fornecedor. Edite o contato e marque como Fornecedor.');
    }
    return {
      contact_id: contact.id,
      supplier_name: contact.name,
      supplier_doc: contact.document ?? undefined,
    };
  }

  /**
   * Valida que a natureza pertence à empresa e é do tipo DESPESA
   * (Contas a Pagar é sempre despesa).
   */
  private async validateNature(natureId: string | undefined, companyId: string) {
    if (!natureId) return;
    const nature = await this.prisma.financialNature.findUnique({ where: { id: natureId } });
    if (!nature || nature.metadeleted) {
      throw new BadRequestException('Natureza contábil não encontrada.');
    }
    if (nature.company_id !== companyId) {
      throw new BadRequestException('Natureza não pertence à empresa selecionada.');
    }
    if (nature.type !== NatureType.DESPESA) {
      throw new BadRequestException('Naturezas de Receita não podem ser usadas em Contas a Pagar.');
    }
    if (!nature.is_active) {
      throw new BadRequestException('Esta natureza está inativa. Selecione outra.');
    }
  }

  /**
   * Procura possível duplicata: mesma empresa, mesmo CNPJ/CPF do fornecedor
   * (quando informado), mesmo número de documento OU mesmo valor com data de
   * emissão dentro de ±5 dias. Ignora itens já marcados como duplicata.
   */
  private async findPotentialDuplicate(args: {
    company_id: string;
    supplier_doc?: string | null;
    document_number?: string | null;
    amount: bigint;
    issue_date: Date;
    excludeId?: string;
  }) {
    const { company_id, supplier_doc, document_number, amount, issue_date, excludeId } = args;
    if (!supplier_doc && !document_number) return null;
    const dateFrom = new Date(issue_date);
    dateFrom.setUTCDate(dateFrom.getUTCDate() - 5);
    const dateTo = new Date(issue_date);
    dateTo.setUTCDate(dateTo.getUTCDate() + 5);

    const orConds: any[] = [];
    if (document_number) orConds.push({ document_number });
    orConds.push({ amount, issue_date: { gte: dateFrom, lte: dateTo } });

    return this.prisma.accountPayable.findFirst({
      where: {
        company_id,
        metadeleted: false,
        duplicate_of_id: null,
        ...(supplier_doc ? { supplier_doc } : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: orConds,
      },
      include: {
        contact: { select: { id: true, name: true, document: true } },
        nature: { select: { id: true, name: true, dre_section: true } },
      },
    });
  }

  async checkDuplicate(query: any, current: any) {
    if (!query.amount || !query.issue_date) {
      return { duplicate: null };
    }
    const company_id = query.company_id || current.company_id;
    if (!company_id) return { duplicate: null };
    if (current.profile === Profile.MANAGER && current.company_id !== company_id) {
      throw new BadRequestException('Sem acesso a esta empresa.');
    }
    const dup = await this.findPotentialDuplicate({
      company_id,
      supplier_doc: query.supplier_doc || null,
      document_number: query.document_number || null,
      amount: BigInt(query.amount),
      issue_date: new Date(query.issue_date),
      excludeId: query.exclude_id,
    });
    return serializeBigInt({ duplicate: dup });
  }

  async create(dto: CreateAccountPayableDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);

    const contactData = await this.resolveContact(dto.contact_id, company_id);
    await this.validateNature(dto.nature_id, company_id);

    const supplier_doc = contactData.supplier_doc ?? dto.supplier_doc;
    const issue_date = new Date(dto.issue_date);
    const amountBig = BigInt(dto.amount);

    let duplicate_of_id: string | null = null;
    const existing = await this.findPotentialDuplicate({
      company_id,
      supplier_doc,
      document_number: dto.document_number,
      amount: amountBig,
      issue_date,
    });
    if (existing) {
      if (!dto.force_duplicate) {
        throw new BadRequestException({
          code: 'DUPLICATE_DETECTED',
          message: 'Já existe um lançamento similar.',
          existing: serializeBigInt(existing),
        });
      }
      duplicate_of_id = existing.id;
    }

    const data: any = {
      description: dto.description,
      amount: amountBig,
      issue_date,
      due_date: new Date(dto.due_date),
      company_id,
      supplier_name: contactData.supplier_name ?? dto.supplier_name,
      supplier_doc,
      source: PayableSource.MANUAL,
      duplicate_of_id,
    };
    if (contactData.contact_id) data.contact_id = contactData.contact_id;
    if (dto.document_number) data.document_number = dto.document_number;
    if (dto.notes) data.notes = dto.notes;
    if (dto.brand_id) data.brand_id = dto.brand_id;
    if (dto.category_id) data.category_id = dto.category_id;
    if (dto.nature_id) data.nature_id = dto.nature_id;
    if (dto.account_id) data.account_id = dto.account_id;
    if (dto.is_recurring !== undefined) data.is_recurring = dto.is_recurring;
    if (dto.is_deductible_expense !== undefined) data.is_deductible_expense = dto.is_deductible_expense;
    if (dto.generates_pis_cofins_credit !== undefined) data.generates_pis_cofins_credit = dto.generates_pis_cofins_credit;

    const payable = await this.prisma.accountPayable.create({
      data,
      include: {
        contact: { select: { id: true, name: true, document: true } },
        nature: { select: { id: true, name: true, type: true, dre_section: true } },
      },
    });
    await this.audit.log('CREATE', 'ACCOUNT_PAYABLE', payable.id, current.id);
    return serializeBigInt(payable);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.description) where.description = { contains: filters.description, mode: 'insensitive' };
    if (filters.supplier_name) where.supplier_name = { contains: filters.supplier_name, mode: 'insensitive' };
    if (filters.contact_id) where.contact_id = filters.contact_id;
    if (filters.nature_id) where.nature_id = filters.nature_id;
    if (filters.status) where.status = filters.status;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.due_from || filters.due_to) {
      where.due_date = {};
      if (filters.due_from) where.due_date.gte = new Date(filters.due_from);
      if (filters.due_to) where.due_date.lte = new Date(filters.due_to);
    }
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.accountPayable.findMany({
        where,
        orderBy: { due_date: 'asc' },
        include: {
          contact: { select: { id: true, name: true, document: true } },
          category: { select: { id: true, name: true, color: true } },
          nature: { select: { id: true, name: true, type: true, dre_section: true } },
          brand: { select: { id: true, name: true } },
          account: { select: { id: true, code: true, name: true } },
        },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.accountPayable.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const p = await this.prisma.accountPayable.findUnique({
      where: { id },
      include: {
        contact: true,
        category: true,
        nature: true,
        brand: true,
        account: true,
      },
    });
    if (!p || p.metadeleted) throw new NotFoundException('Conta não encontrada.');
    assertTenantAccess(p, current);
    return serializeBigInt(p);
  }

  async update(id: string, dto: UpdateAccountPayableDto, current: any) {
    const existing = await this.findOne(id, current);
    if (existing.status === 'PAID') {
      throw new BadRequestException('Conta já paga não pode ser editada. Cancele o pagamento primeiro.');
    }

    if (dto.nature_id !== undefined && dto.nature_id !== '') {
      await this.validateNature(dto.nature_id, existing.company_id);
    }

    const data: any = {};
    if (dto.description) data.description = dto.description;
    if (dto.amount !== undefined) data.amount = BigInt(dto.amount);
    if (dto.issue_date) data.issue_date = new Date(dto.issue_date);
    if (dto.due_date) data.due_date = new Date(dto.due_date);
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.brand_id !== undefined) data.brand_id = dto.brand_id || null;
    if (dto.category_id !== undefined) data.category_id = dto.category_id || null;
    if (dto.nature_id !== undefined) data.nature_id = dto.nature_id || null;
    if (dto.account_id !== undefined) data.account_id = dto.account_id || null;
    if (dto.document_number !== undefined) data.document_number = dto.document_number;

    if (dto.contact_id !== undefined) {
      if (dto.contact_id === '' || dto.contact_id === null) {
        data.contact_id = null;
        if (dto.supplier_name !== undefined) data.supplier_name = dto.supplier_name;
        if (dto.supplier_doc !== undefined) data.supplier_doc = dto.supplier_doc;
      } else {
        const contactData = await this.resolveContact(dto.contact_id, existing.company_id);
        data.contact_id = contactData.contact_id;
        data.supplier_name = contactData.supplier_name;
        data.supplier_doc = contactData.supplier_doc;
      }
    } else {
      if (dto.supplier_name !== undefined) data.supplier_name = dto.supplier_name;
      if (dto.supplier_doc !== undefined) data.supplier_doc = dto.supplier_doc;
    }

    const updated = await this.prisma.accountPayable.update({
      where: { id },
      data,
      include: {
        contact: { select: { id: true, name: true, document: true } },
        nature: { select: { id: true, name: true, type: true, dre_section: true } },
      },
    });
    await this.audit.log('UPDATE', 'ACCOUNT_PAYABLE', id, current.id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    const existing = await this.findOne(id, current);
    if (existing.status === 'PAID') {
      throw new BadRequestException('Conta já paga não pode ser excluída.');
    }
    await this.prisma.accountPayable.update({
      where: { id },
      data: { metadeleted: true },
    });
    await this.audit.log('DELETE', 'ACCOUNT_PAYABLE', id, current.id);
    return { ok: true };
  }

  async pay(id: string, dto: PayDto, current: any) {
    const payable = await this.findOne(id, current);
    if (payable.status === 'PAID') throw new BadRequestException('Conta já paga.');
    if (payable.status === 'CANCELLED') throw new BadRequestException('Conta cancelada não pode ser paga.');

    const bankAccount = await this.prisma.bankAccount.findUnique({ where: { id: dto.bank_account_id } });
    if (!bankAccount || bankAccount.metadeleted) throw new BadRequestException('Conta bancária inválida.');
    if (bankAccount.company_id !== payable.company_id) {
      throw new BadRequestException('Conta bancária não pertence à mesma empresa.');
    }

    const paid_amount = BigInt(dto.paid_amount ?? Number(payable.amount));
    const isPartial = paid_amount < BigInt(payable.amount);

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          description: `Pagamento: ${payable.description}`,
          amount: paid_amount,
          type: TransactionType.EXPENSE,
          date: new Date(dto.payment_date),
          company_id: payable.company_id,
          brand_id: payable.brand_id,
          bank_account_id: dto.bank_account_id,
          category_id: payable.category_id,
          account_id: payable.account_id,
          payable_id: payable.id,
          notes: 'Lançamento gerado automaticamente pelo pagamento de conta',
        },
      });

      await tx.bankAccount.update({
        where: { id: dto.bank_account_id },
        data: { current_balance: { decrement: paid_amount } },
      });

      await tx.accountPayable.update({
        where: { id },
        data: {
          status: isPartial ? PaymentStatus.PARTIAL : PaymentStatus.PAID,
          paid_amount: BigInt(payable.paid_amount) + paid_amount,
          payment_date: new Date(dto.payment_date),
        },
      });
    });

    await this.audit.log('PAY', 'ACCOUNT_PAYABLE', id, current.id, { paid_amount: paid_amount.toString() });
    await this.safePost(id);
    return { ok: true };
  }
}

@ApiTags('financial/accounts-payable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/accounts-payable')
export class AccountsPayableController {
  constructor(private service: AccountsPayableService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('check-duplicate')
  checkDuplicate(@Query() q: any, @CurrentUser() user: any) {
    return this.service.checkDuplicate(q, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateAccountPayableDto, @CurrentUser() user: any) {
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
  update(@Param('id') id: string, @Body() dto: UpdateAccountPayableDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() dto: PayDto, @CurrentUser() user: any) {
    return this.service.pay(id, dto, user);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [AccountsPayableController],
  providers: [AccountsPayableService],
  exports: [AccountsPayableService],
})
export class AccountsPayableModule {}
