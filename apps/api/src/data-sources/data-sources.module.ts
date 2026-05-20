import {
  Module, Injectable, NotFoundException, BadRequestException, Logger,
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';
import { IsString, IsOptional, IsEnum, MaxLength, MinLength, IsDateString } from 'class-validator';
import { Profile, GgrSourceType, DataSourceStatus } from '@prisma/client';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { buildTenantWhere, assertTenantAccess } from '../financial/tenant.helper';
import { encrypt, decrypt } from '../fiscal/crypto.helper';
import { serializeBigInt } from '../financial/money.helper';

class CreateDataSourceDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() brand_id: string;
  @IsEnum(GgrSourceType) type: GgrSourceType;          // API_REST, CSV_UPLOAD, etc.
  @IsOptional() @IsString() base_url?: string;
  @IsOptional() @IsString() auth_type?: string;        // 'BEARER' | 'API_KEY' | 'BASIC'
  @IsOptional() @IsString() auth_token?: string;
  @IsOptional() field_mapping?: any;                   // mapa de campos custom
  @IsOptional() config?: any;                          // { date_param_name, brand_param_name, etc. }
  @IsOptional() @IsString() company_id?: string;
}

class UpdateDataSourceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(DataSourceStatus) status?: DataSourceStatus;
  @IsOptional() @IsString() base_url?: string;
  @IsOptional() @IsString() auth_type?: string;
  @IsOptional() @IsString() auth_token?: string;
  @IsOptional() field_mapping?: any;
  @IsOptional() config?: any;
}

class SyncRangeDto {
  @IsOptional() @IsDateString() start_date?: string;
  @IsOptional() @IsDateString() end_date?: string;
}

interface ParsedTotalizadores {
  date: Date;
  total_bets: bigint;
  total_prizes: bigint;
  total_deposits: bigint;
  total_withdrawals: bigint;
  total_bonus: bigint;
  bet_count: number;
  prize_count: number;
  deposit_count: number;
  withdrawal_count: number;
  active_players: number;
}

@Injectable()
export class DataSourcesService {
  private readonly logger = new Logger(DataSourcesService.name);

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ============= CRUD =============

  async create(dto: CreateDataSourceDto, current: any) {
    const company_id = current.profile === Profile.MANAGER ? current.company_id : dto.company_id;
    if (!company_id) throw new BadRequestException('company_id obrigatório.');

    // Valida que a brand pertence à empresa
    const brand = await this.prisma.brand.findUnique({ where: { id: dto.brand_id } });
    if (!brand || brand.metadeleted || brand.company_id !== company_id) {
      throw new BadRequestException('Marca inválida ou não pertence à empresa.');
    }

    const data: any = {
      name: dto.name,
      type: dto.type,
      brand_id: dto.brand_id,
      company_id,
      base_url: dto.base_url,
      auth_type: dto.auth_type,
      auth_token: dto.auth_token ? encrypt(dto.auth_token) : null,
      field_mapping: dto.field_mapping ?? undefined,
      config: dto.config ?? undefined,
      status: DataSourceStatus.ACTIVE,
    };

    const ds = await this.prisma.dataSource.create({
      data,
      include: { brand: { select: { id: true, name: true } }, company: { select: { id: true, name: true } } },
    });
    await this.audit.log('CREATE', 'DATA_SOURCE', ds.id, current.id);
    return this.maskAndSerialize(ds);
  }

  async findAll(filters: any, current: any) {
    const where = buildTenantWhere(current, {}, { allowOwner: false });
    if (filters.brand_id) where.brand_id = filters.brand_id;
    if (filters.company_id && current.profile === Profile.ADMIN) where.company_id = filters.company_id;
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;

    const data = await this.prisma.dataSource.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        brand: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });
    return { data: data.map(d => this.maskAndSerialize(d)), total: data.length };
  }

  async findOne(id: string, current: any) {
    const ds = await this.prisma.dataSource.findUnique({
      where: { id },
      include: {
        brand: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!ds || ds.metadeleted) throw new NotFoundException('Fonte de dados não encontrada.');
    assertTenantAccess(ds, current);
    return this.maskAndSerialize(ds);
  }

  async update(id: string, dto: UpdateDataSourceDto, current: any) {
    const existing = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!existing || existing.metadeleted) throw new NotFoundException('Fonte de dados não encontrada.');
    assertTenantAccess(existing, current);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.base_url !== undefined) data.base_url = dto.base_url;
    if (dto.auth_type !== undefined) data.auth_type = dto.auth_type;
    // Só atualiza o token se foi enviado um novo (string não-vazia, sem ser o mascarado)
    if (dto.auth_token !== undefined && dto.auth_token && !dto.auth_token.includes('•')) {
      data.auth_token = encrypt(dto.auth_token);
    }
    if (dto.field_mapping !== undefined) data.field_mapping = dto.field_mapping;
    if (dto.config !== undefined) data.config = dto.config;

    const updated = await this.prisma.dataSource.update({
      where: { id }, data,
      include: { brand: { select: { id: true, name: true } }, company: { select: { id: true, name: true } } },
    });
    await this.audit.log('UPDATE', 'DATA_SOURCE', id, current.id);
    return this.maskAndSerialize(updated);
  }

  async remove(id: string, current: any) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds || ds.metadeleted) throw new NotFoundException('Fonte de dados não encontrada.');
    assertTenantAccess(ds, current);
    await this.prisma.dataSource.update({ where: { id }, data: { metadeleted: true } });
    await this.audit.log('DELETE', 'DATA_SOURCE', id, current.id);
    return { ok: true };
  }

  // ============= Test connection =============

  async testConnection(id: string, current: any) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id }, include: { brand: true } });
    if (!ds || ds.metadeleted) throw new NotFoundException('Fonte de dados não encontrada.');
    assertTenantAccess(ds, current);

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    today.setUTCDate(today.getUTCDate() - 1); // ontem (para evitar dia em curso)
    const dateStr = today.toISOString().slice(0, 10);

    try {
      const res = await this.callExternal(ds, dateStr);
      return {
        ok: true,
        http_status: res.status,
        sample_keys: Object.keys(res.data?.totalizadores ?? res.data ?? {}),
        date_tested: dateStr,
      };
    } catch (err: any) {
      return {
        ok: false,
        http_status: err.response?.status ?? null,
        error: err.message,
        details: err.response?.data ?? null,
        date_tested: dateStr,
      };
    }
  }

  // ============= Sync =============

  /**
   * Sincroniza um intervalo de datas. Se start/end ausentes, usa apenas ontem.
   */
  async syncRange(id: string, dto: SyncRangeDto, current: any) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id }, include: { brand: true } });
    if (!ds || ds.metadeleted) throw new NotFoundException('Fonte de dados não encontrada.');
    assertTenantAccess(ds, current);
    if (ds.type !== GgrSourceType.API_REST) {
      throw new BadRequestException('Sincronização automática só funciona para fontes do tipo API_REST.');
    }
    if (!ds.base_url) throw new BadRequestException('URL base não configurada.');

    let start: Date, end: Date;
    if (dto.start_date && dto.end_date) {
      start = new Date(dto.start_date);
      end = new Date(dto.end_date);
    } else {
      // Default: ontem (1 dia)
      const yesterday = new Date(); yesterday.setUTCHours(0, 0, 0, 0);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      start = end = yesterday;
    }
    if (start > end) throw new BadRequestException('start_date posterior a end_date.');

    return this.syncDateRangeInternal(ds, start, end, current?.id);
  }

  /**
   * Implementação core do sync por range (usada tanto via API quanto via cron).
   */
  private async syncDateRangeInternal(ds: any, start: Date, end: Date, userId?: string) {
    const result = { synced: 0, skipped: 0, errors: [] as { date: string; error: string }[] };
    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      try {
        const res = await this.callExternal(ds, dateStr);
        if (res.status === 204) {
          result.skipped++;
          this.logger.warn(`[DataSource ${ds.id}] ${dateStr}: 204 sem dados`);
        } else {
          const parsed = this.parseTotalizadoresPayload(res.data, cur);
          await this.upsertGgrRecord(ds, parsed);
          result.synced++;
        }
      } catch (err: any) {
        const errMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message || 'Erro desconhecido';
        result.errors.push({ date: dateStr, error: errMsg });
        this.logger.error(`[DataSource ${ds.id}] ${dateStr}: ${errMsg}`);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    // Salva last_sync_at e último erro (se houver)
    await this.prisma.dataSource.update({
      where: { id: ds.id },
      data: {
        last_sync_at: new Date(),
        last_error: result.errors.length > 0 ? `${result.errors.length} erro(s): ${result.errors[0].error}` : null,
        status: result.errors.length > result.synced ? DataSourceStatus.ERROR : DataSourceStatus.ACTIVE,
      },
    });
    if (userId) await this.audit.log('SYNC', 'DATA_SOURCE', ds.id, userId, result);
    return result;
  }

  /**
   * Faz a chamada HTTP externa para a API da operadora.
   * Espera o formato definido em docs/contbet-integration-spec.md
   */
  private async callExternal(ds: any, dateStr: string) {
    const dateParam = ds.config?.date_param_name ?? 'date';
    const brandParam = ds.config?.brand_param_name ?? 'brand_code';
    const brandValue = ds.config?.brand_code ?? ds.brand?.name;

    const params: Record<string, string> = { [dateParam]: dateStr };
    if (brandValue) params[brandParam] = brandValue;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (ds.auth_token) {
      const token = decrypt(ds.auth_token);
      const authType = (ds.auth_type ?? 'BEARER').toUpperCase();
      if (authType === 'BEARER') headers['Authorization'] = `Bearer ${token}`;
      else if (authType === 'API_KEY') headers['x-api-key'] = token;
      else if (authType === 'BASIC') headers['Authorization'] = `Basic ${token}`;
    }

    return axios.get(ds.base_url, { params, headers, timeout: 30000 });
  }

  /**
   * Parser do JSON retornado pela operadora — converte campos em reais para
   * BigInt em centavos. Aceita o formato canônico ContBet OU mapeamento custom.
   */
  private parseTotalizadoresPayload(payload: any, defaultDate: Date): ParsedTotalizadores {
    const t = payload?.totalizadores ?? payload ?? {};
    const m = (key: string): bigint => {
      const v = t[key];
      if (v === undefined || v === null || v === '') return 0n;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (isNaN(n)) return 0n;
      return BigInt(Math.round(n * 100));
    };
    const i = (key: string): number => {
      const v = t[key];
      if (v === undefined || v === null || v === '') return 0;
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      return isNaN(n) ? 0 : n;
    };
    let date = defaultDate;
    if (payload?.date) {
      const d = new Date(payload.date);
      if (!isNaN(d.getTime())) date = d;
    }
    return {
      date,
      total_bets:        m('total_bets'),
      total_prizes:      m('total_prizes'),
      total_deposits:    m('total_deposits'),
      total_withdrawals: m('total_withdrawals'),
      total_bonus:       m('total_bonus'),
      bet_count:         i('bet_count'),
      prize_count:       i('prize_count'),
      deposit_count:     i('deposit_count'),
      withdrawal_count:  i('withdrawal_count'),
      active_players:    i('active_players'),
    };
  }

  /**
   * Cria ou atualiza o GgrDailyRecord para a marca/data.
   * Idempotente — pode rodar múltiplas vezes sem duplicar.
   */
  private async upsertGgrRecord(ds: any, t: ParsedTotalizadores) {
    const dateOnly = new Date(Date.UTC(t.date.getUTCFullYear(), t.date.getUTCMonth(), t.date.getUTCDate()));
    const ggr = t.total_bets - t.total_prizes;

    const data = {
      date: dateOnly,
      total_bets: t.total_bets,
      total_prizes: t.total_prizes,
      total_deposits: t.total_deposits,
      total_withdrawals: t.total_withdrawals,
      total_bonus: t.total_bonus,
      bet_count: t.bet_count,
      prize_count: t.prize_count,
      deposit_count: t.deposit_count,
      withdrawal_count: t.withdrawal_count,
      active_players: t.active_players,
      ggr,
      source_type: GgrSourceType.API_REST,
      source_reference: ds.name,
      data_source_id: ds.id,
      brand_id: ds.brand_id,
      company_id: ds.company_id,
    };

    await this.prisma.ggrDailyRecord.upsert({
      where: { brand_id_date: { brand_id: ds.brand_id, date: dateOnly } },
      update: data,
      create: data,
    });
  }

  // ============= Cron =============

  /**
   * Executa às 04:00 BRT (07:00 UTC) diariamente. Sincroniza todos os
   * DataSources ACTIVE do tipo API_REST puxando os dados de ontem.
   *
   * Pode ser desligado via env var DATA_SOURCE_CRON_DISABLED=true.
   */
  @Cron('0 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async dailySyncJob() {
    if (process.env.DATA_SOURCE_CRON_DISABLED === 'true') {
      this.logger.log('DATA_SOURCE_CRON_DISABLED=true — pulando sync diário.');
      return;
    }
    const sources = await this.prisma.dataSource.findMany({
      where: {
        metadeleted: false,
        status: DataSourceStatus.ACTIVE,
        type: GgrSourceType.API_REST,
      },
      include: { brand: true },
    });
    this.logger.log(`Sync diário iniciado — ${sources.length} fontes ACTIVE.`);

    const yesterday = new Date(); yesterday.setUTCHours(0, 0, 0, 0);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    for (const ds of sources) {
      try {
        const r = await this.syncDateRangeInternal(ds, yesterday, yesterday);
        this.logger.log(`[${ds.name}] sync: ${r.synced} OK · ${r.skipped} sem dados · ${r.errors.length} erros`);
      } catch (err: any) {
        this.logger.error(`[${ds.name}] sync falhou: ${err.message}`);
      }
    }
  }

  // ============= Helpers =============

  private maskAndSerialize(ds: any) {
    const masked = { ...ds };
    if (masked.auth_token) {
      masked.auth_token = `${masked.auth_token.slice(0, 6)}••••${masked.auth_token.slice(-4)}`;
    }
    return serializeBigInt(masked);
  }
}

@ApiTags('data-sources')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('data-sources')
export class DataSourcesController {
  constructor(private service: DataSourcesService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post()
  create(@Body() dto: CreateDataSourceDto, @CurrentUser() user: any) {
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
  update(@Param('id') id: string, @Body() dto: UpdateDataSourceDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post(':id/test')
  test(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.testConnection(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post(':id/sync')
  sync(@Param('id') id: string, @Body() dto: SyncRangeDto, @CurrentUser() user: any) {
    return this.service.syncRange(id, dto, user);
  }
}

@Module({
  controllers: [DataSourcesController],
  providers: [DataSourcesService],
  exports: [DataSourcesService],
})
export class DataSourcesModule {}
