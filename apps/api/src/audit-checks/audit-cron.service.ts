import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditChecksService } from './audit-checks.service';

/**
 * Roda as 3 auditorias (movements, fees, taxes) automaticamente uma vez
 * por dia, para todas as empresas com dados. Gera AuditAlert quando muda
 * o status para WARNING ou CRITICAL.
 *
 * Período de cada execução: últimos 30 dias até hoje.
 *
 * Para desligar temporariamente: setar variável de ambiente AUDIT_CRON_DISABLED=true.
 */
@Injectable()
export class AuditCronService {
  private readonly logger = new Logger(AuditCronService.name);
  constructor(
    private prisma: PrismaService,
    private auditChecks: AuditChecksService,
  ) {}

  // Roda às 03:00 da manhã (após o dia fechar nos bancos e provedores)
  @Cron('0 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyAudits() {
    if (process.env.AUDIT_CRON_DISABLED === 'true') {
      this.logger.log('AUDIT_CRON_DISABLED=true — pulando execução.');
      return;
    }
    this.logger.log('Iniciando rodada diária de auditorias.');
    const companies = await this.prisma.company.findMany({
      where: { metadeleted: false },
      select: { id: true, name: true },
    });

    const today = new Date();
    const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);

    // "Usuário" simulado para auditoria automática (system)
    const systemUser = { id: 'system-cron', profile: 'ADMIN', company_id: null };

    for (const c of companies) {
      try {
        await this.auditChecks.movementsCheck(
          { company_id: c.id, from: fromStr, to: toStr } as any, systemUser as any,
        );
      } catch (e: any) { this.logger.warn(`movements ${c.name}: ${e?.message}`); }
      try {
        await this.auditChecks.feesCheck(
          { company_id: c.id, from: fromStr, to: toStr } as any, systemUser as any,
        );
      } catch (e: any) { this.logger.warn(`fees ${c.name}: ${e?.message}`); }
      try {
        await this.auditChecks.taxesCheck(
          { company_id: c.id, from: fromStr, to: toStr } as any, systemUser as any,
        );
      } catch (e: any) { this.logger.warn(`taxes ${c.name}: ${e?.message}`); }
    }

    this.logger.log(`Rodada diária concluída para ${companies.length} empresa(s).`);
  }
}
