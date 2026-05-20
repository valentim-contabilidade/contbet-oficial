import {
  Module, Controller, Get, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Profile } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { DreService, DreInput } from './dre.service';
import { CashFlowService, CashFlowInput } from './cash-flow.service';
import { PeriodType } from './period.helper';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private dreService: DreService,
    private cashFlowService: CashFlowService,
  ) {}

  // OPERADOR (gestor de marca) tem acesso só à DRE/Fluxo de uma das suas marcas
  // (o service deve respeitar a marca selecionada e validar acesso).
  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('dre')
  generateDre(@Query() q: any, @CurrentUser() user: any) {
    if (!q.company_id) {
      throw new Error('company_id obrigatório.');
    }

    const input: DreInput = {
      company_id: q.company_id,
      brand_id: q.brand_id || undefined,
      period_type: (q.period_type || 'monthly') as PeriodType,
      year: q.year ? parseInt(q.year) : new Date().getFullYear(),
      month: q.month ? parseInt(q.month) : undefined,
      quarter: q.quarter ? parseInt(q.quarter) : undefined,
      start_date: q.start_date,
      end_date: q.end_date,
    };

    return this.dreService.generateDre(input, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER, Profile.OWNER)
  @Get('cash-flow')
  generateCashFlow(@Query() q: any, @CurrentUser() user: any) {
    if (!q.company_id) {
      throw new Error('company_id obrigatório.');
    }

    const input: CashFlowInput = {
      company_id: q.company_id,
      brand_id: q.brand_id || undefined,
      period_type: (q.period_type || 'monthly') as PeriodType,
      year: q.year ? parseInt(q.year) : new Date().getFullYear(),
      month: q.month ? parseInt(q.month) : undefined,
      quarter: q.quarter ? parseInt(q.quarter) : undefined,
      start_date: q.start_date,
      end_date: q.end_date,
      include_projected: q.include_projected !== 'false',
    };

    return this.cashFlowService.generate(input, user);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [DreService, CashFlowService],
  exports: [DreService, CashFlowService],
})
export class ReportsModule {}
