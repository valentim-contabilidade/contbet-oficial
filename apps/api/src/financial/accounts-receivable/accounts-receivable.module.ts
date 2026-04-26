import {
  Module, Injectable, NotFoundException, BadRequestException,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsNumber, IsDateString, MaxLength, Min, MinLength, IsBoolean,
} from 'class-validator';
import { Profile, PaymentStatus, TransactionType, NatureType, RevenueType } from '@prisma/client';
import { IsEnum } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess, resolveCompanyForCreate } from '../tenant.helper';
import { serializeBigInt } from '../money.helper';
import { AccountingModule } from '../../accounting/accounting.module';
import { JournalPostingService } from '../../accounting/journal-posting.service';

class CreateAccountReceivableDto {
  @IsString() @MinLength(2) @MaxLength(300) description: string;
  @IsOptional() @IsString() @MaxLength(200) customer_name?: string;
  @IsOptional() @IsString() @MaxLength(20) customer_doc?: string;
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
  @IsOptional() @IsEnum(RevenueType) revenue_type?: RevenueType;
}

class UpdateAccountReceivableDto {
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MaxLength(200) customer_name?: string;
  @IsOptional() @IsString() @MaxLength(20) customer_doc?: string;
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
  @IsOptional() @IsEnum(RevenueType) revenue_type?: RevenueType;
}

class ReceiveDto {
  @IsString() bank_account_id: string;
  @IsDateString() receipt_date: string;
  @IsOptional() @IsNumber() @Min(1) received_amount?: number;
}

@Injectable()
export class AccountsReceivableService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private posting: JournalPostingService,
  ) {}

  private async safePost(id: string) {
    try { await this.posting.postReceivableReceived(id); }
    catch (e: any) { console.warn(`[Receivable posting] ${id}: ${e?.message ?? e}`); }
  }
  private async safePostIssued(id: string) {
    try { await this.posting.postReceivableIssued(id); }
    catch (e: any) { console.warn(`[Receivable issued posting] ${id}: ${e?.message ?? e}`); }
  }

  private async resolveContact(contactId: string | undefined, companyId: string) {
    if (!contactId) return { contact_id: undefined, customer_name: undefined, customer_doc: undefined };
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.metadeleted) {
      throw new BadRequestException('Contato não encontrado.');
    }
    if (contact.company_id !== companyId) {
      throw new BadRequestException('Contato não pertence à empresa selecionada.');
    }
    if (!contact.is_customer) {
      throw new BadRequestException('Contato selecionado não é um cliente. Edite o contato e marque como Cliente.');
    }
    return {
      contact_id: contact.id,
      customer_name: contact.name,
      customer_doc: contact.document ?? undefined,
    };
  }

  /**
   * Valida que a natureza pertence à empresa e é do tipo RECEITA
   * (Contas a Receber é sempre receita).
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
    if (nature.type !== NatureType.RECEITA) {
      throw new BadRequestException('Naturezas de Despesa não podem ser usadas em Contas a Receber.');
    }
    if (!nature.is_active) {
      throw new BadRequestException('Esta natureza está inativa. Selecione outra.');
    }
  }

  async create(dto: CreateAccountReceivableDto, current: any) {
    const company_id = resolveCompanyForCreate(dto, current);

    const contactData = await this.resolveContact(dto.contact_id, company_id);
    await this.validateNature(dto.nature_id, company_id);

    const data: any = {
      description: dto.description,
      amount: BigInt(dto.amount),
      issue_date: new Date(dto.issue_date),
      due_date: new Date(dto.due_date),
      company_id,
      customer_name: contactData.customer_name ?? dto.customer_name,
      customer_doc: contactData.customer_doc ?? dto.customer_doc,
    };
    if (contactData.contact_id) data.contact_id = contactData.contact_id;
    if (dto.document_number) data.document_number = dto.document_number;
    if (dto.notes) data.notes = dto.notes;
    if (dto.brand_id) data.brand_id = dto.brand_id;
    if (dto.category_id) data.category_id = dto.category_id;
    if (dto.nature_id) data.nature_id = dto.nature_id;
    if (dto.account_id) data.account_id = dto.account_id;
    if (dto.is_recurring !== undefined) data.is_recurring = dto.is_recurring;
    if (dto.revenue_type !== undefined) data.revenue_type = dto.revenue_type;

    const receivable = await this.prisma.accountReceivable.create({
      data,
      include: {
        contact: { select: { id: true, name: true, document: true } },
        nature: { select: { id: true, name: true, type: true, dre_section: true } },
      },
    });
    await this.audit.log('CREATE', 'ACCOUNT_RECEIVABLE', receivable.id, current.id);
    await this.safePostIssued(receivable.id);
    return serializeBigInt(receivable);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.description) where.description = { contains: filters.description, mode: 'insensitive' };
    if (filters.customer_name) where.customer_name = { contains: filters.customer_name, mode: 'insensitive' };
    if (filters.contact_id) where.contact_id = filters.contact_id;
    if (filters.nature_id) where.nature_id = filters.nature_id;
    if (filters.status) where.status = filters.status;
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.revenue_type) where.revenue_type = filters.revenue_type;
    if (filters.due_from || filters.due_to) {
      where.due_date = {};
      if (filters.due_from) where.due_date.gte = new Date(filters.due_from);
      if (filters.due_to) where.due_date.lte = new Date(filters.due_to);
    }
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;

    const page = Math.max(1, parseInt(filters.page ?? '1', 10));
    const [data, total] = await Promise.all([
      this.prisma.accountReceivable.findMany({
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
      this.prisma.accountReceivable.count({ where }),
    ]);
    return serializeBigInt({ data, total, page, per_page: 50 });
  }

  async findOne(id: string, current: any) {
    const r = await this.prisma.accountReceivable.findUnique({
      where: { id },
      include: { contact: true, category: true, nature: true, brand: true, account: true },
    });
    if (!r || r.metadeleted) throw new NotFoundException('Conta não encontrada.');
    assertTenantAccess(r, current);
    return serializeBigInt(r);
  }

  async update(id: string, dto: UpdateAccountReceivableDto, current: any) {
    const existing = await this.findOne(id, current);
    if (existing.status === 'PAID') {
      throw new BadRequestException('Recebimento já confirmado não pode ser editado.');
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
    if (dto.revenue_type !== undefined) data.revenue_type = dto.revenue_type;

    if (dto.contact_id !== undefined) {
      if (dto.contact_id === '' || dto.contact_id === null) {
        data.contact_id = null;
        if (dto.customer_name !== undefined) data.customer_name = dto.customer_name;
        if (dto.customer_doc !== undefined) data.customer_doc = dto.customer_doc;
      } else {
        const contactData = await this.resolveContact(dto.contact_id, existing.company_id);
        data.contact_id = contactData.contact_id;
        data.customer_name = contactData.customer_name;
        data.customer_doc = contactData.customer_doc;
      }
    } else {
      if (dto.customer_name !== undefined) data.customer_name = dto.customer_name;
      if (dto.customer_doc !== undefined) data.customer_doc = dto.customer_doc;
    }

    const updated = await this.prisma.accountReceivable.update({
      where: { id },
      data,
      include: {
        contact: { select: { id: true, name: true, document: true } },
        nature: { select: { id: true, name: true, type: true, dre_section: true } },
      },
    });
    await this.audit.log('UPDATE', 'ACCOUNT_RECEIVABLE', id, current.id);
    await this.safePostIssued(id);
    return serializeBigInt(updated);
  }

  async remove(id: string, current: any) {
    const existing = await this.findOne(id, current);
    if (existing.status === 'PAID') {
      throw new BadRequestException('Recebimento já confirmado não pode ser excluído.');
    }
    await this.prisma.accountReceivable.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'ACCOUNT_RECEIVABLE', id, current.id);
    await this.safePostIssued(id);
    return { ok: true };
  }

  async receive(id: string, dto: ReceiveDto, current: any) {
    const receivable = await this.findOne(id, current);
    if (receivable.status === 'PAID') throw new BadRequestException('Já recebido.');
    if (receivable.status === 'CANCELLED') throw new BadRequestException('Conta cancelada.');

    const bankAccount = await this.prisma.bankAccount.findUnique({ where: { id: dto.bank_account_id } });
    if (!bankAccount || bankAccount.metadeleted) throw new BadRequestException('Conta bancária inválida.');
    if (bankAccount.company_id !== receivable.company_id) {
      throw new BadRequestException('Conta bancária não pertence à mesma empresa.');
    }

    const received_amount = BigInt(dto.received_amount ?? Number(receivable.amount));
    const isPartial = received_amount < BigInt(receivable.amount);

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          description: `Recebimento: ${receivable.description}`,
          amount: received_amount,
          type: TransactionType.INCOME,
          date: new Date(dto.receipt_date),
          company_id: receivable.company_id,
          brand_id: receivable.brand_id,
          bank_account_id: dto.bank_account_id,
          category_id: receivable.category_id,
          account_id: receivable.account_id,
          receivable_id: receivable.id,
          notes: 'Lançamento gerado automaticamente pelo recebimento',
        },
      });

      await tx.bankAccount.update({
        where: { id: dto.bank_account_id },
        data: { current_balance: { increment: received_amount } },
      });

      await tx.accountReceivable.update({
        where: { id },
        data: {
          status: isPartial ? PaymentStatus.PARTIAL : PaymentStatus.PAID,
          received_amount: BigInt(receivable.received_amount) + received_amount,
          receipt_date: new Date(dto.receipt_date),
        },
      });
    });

    await this.audit.log('RECEIVE', 'ACCOUNT_RECEIVABLE', id, current.id, { received_amount: received_amount.toString() });
    await this.safePost(id);
    return { ok: true };
  }
}

@ApiTags('financial/accounts-receivable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('financial/accounts-receivable')
export class AccountsReceivableController {
  constructor(private service: AccountsReceivableService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateAccountReceivableDto, @CurrentUser() user: any) {
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
  update(@Param('id') id: string, @Body() dto: UpdateAccountReceivableDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post(':id/receive')
  receive(@Param('id') id: string, @Body() dto: ReceiveDto, @CurrentUser() user: any) {
    return this.service.receive(id, dto, user);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [AccountsReceivableController],
  providers: [AccountsReceivableService],
  exports: [AccountsReceivableService],
})
export class AccountsReceivableModule {}
