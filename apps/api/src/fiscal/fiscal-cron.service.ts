import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalService } from './fiscal.module';

/**
 * Sincronização automática de NFSe/NFe Tomadas via provedor fiscal (Qive,
 * Plugnotas, etc.). Roda a cada 6h para todas as empresas com FiscalProvider
 * `auto_sync_enabled=true`.
 *
 * Período sincronizado a cada execução: últimos 30 dias até hoje (cobre
 * casos onde o provedor demora a indexar nota recém emitida).
 *
 * Desativar: variável de ambiente FISCAL_CRON_DISABLED=true.
 */
@Injectable()
export class FiscalCronService {
  private readonly logger = new Logger(FiscalCronService.name);
  constructor(
    private prisma: PrismaService,
    private fiscal: FiscalService,
  ) {}

  // A cada 6 horas (00:15, 06:15, 12:15, 18:15) — fora dos horários de pico
  @Cron('15 */6 * * *', { timeZone: 'America/Sao_Paulo' })
  async runScheduledSync() {
    if (process.env.FISCAL_CRON_DISABLED === 'true') {
      this.logger.log('FISCAL_CRON_DISABLED=true — pulando sync.');
      return;
    }

    const providers = await this.prisma.fiscalProvider.findMany({
      where: {
        metadeleted: false,
        is_active: true,
        auto_sync_enabled: true,
      },
      include: { company: { select: { id: true, name: true, metadeleted: true } } },
    });

    const eligible = providers.filter(p => p.company && !p.company.metadeleted);
    if (eligible.length === 0) {
      this.logger.log('Nenhum provedor com auto_sync_enabled=true. Pulando.');
      return;
    }

    this.logger.log(`Iniciando sync automática para ${eligible.length} empresas.`);

    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Usuário "system" pra contornar o assertCompanyAccess
    const systemUser: any = {
      id: 'system-fiscal-cron',
      profile: 'ADMIN',
      company_id: null,
    };

    for (const provider of eligible) {
      try {
        const result = await this.fiscal.syncFiscalDocuments(
          {
            company_id: provider.company.id,
            start_date: start.toISOString(),
            end_date: end.toISOString(),
            sync_type: 'auto',
          } as any,
          systemUser,
        );
        const docsFetched = (result as any)?.documents_fetched ?? 0;
        const docsCreated = (result as any)?.documents_created ?? 0;
        this.logger.log(
          `[auto-sync] ${provider.company.name}: ${docsFetched} encontradas, ${docsCreated} novas.`,
        );
      } catch (err: any) {
        this.logger.error(`[auto-sync] ${provider.company.name}: ${err.message}`);
      }
    }
    this.logger.log('Sync automática concluída.');
  }
}
