import {
  Module, Controller, Get, Post, Body, Param, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ScheduleModule } from '@nestjs/schedule';
import { Profile } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import {
  AuditChecksService, MovementsCheckDto, FeesCheckDto, TaxesCheckDto,
} from './audit-checks.service';
import { AuditCronService } from './audit-cron.service';

// =================== CONTROLLER ===================

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('audit')
export class AuditChecksController {
  constructor(private service: AuditChecksService) {}

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('movements-check')
  movementsCheck(@Body() dto: MovementsCheckDto, @CurrentUser() user: any) {
    return this.service.movementsCheck(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('fees-check')
  feesCheck(@Body() dto: FeesCheckDto, @CurrentUser() user: any) {
    return this.service.feesCheck(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('taxes-check')
  taxesCheck(@Body() dto: TaxesCheckDto, @CurrentUser() user: any) {
    return this.service.taxesCheck(dto, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('history/:companyId')
  history(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listAllChecks(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('alerts/:companyId')
  alerts(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listAlerts(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('alerts/:id/ack')
  ackAlert(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.ackAlert(id, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('checks/:companyId')
  list(@Param('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listChecks(companyId, user);
  }

  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('check/:id')
  getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getCheck(id, user);
  }
}

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AuditChecksController],
  providers: [AuditChecksService, AuditCronService],
  exports: [AuditChecksService],
})
export class AuditChecksModule {}
