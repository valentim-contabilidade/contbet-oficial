import { Module, Controller, Post, Body, Headers, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Webhook receiver para Focus NFe.
 *
 * Quando uma NFSe muda de status (autorizada / cancelada / rejeitada pela
 * prefeitura), Focus dispara um POST aqui com o `ref` que a gente passou na
 * emissão. A gente usa esse ref pra encontrar o FiscalDocument correspondente
 * (campo `provider_document_id`) e atualizar status + número/protocolo.
 *
 * Configuração no painel da Focus NFe:
 *   URL: https://seu-dominio.com.br/api/webhooks/focus-nfe
 *   Eventos: NFSe (autorização, cancelamento, rejeição)
 *
 * Autenticação: usamos um shared secret no header `X-Focus-Webhook-Secret`
 * (definido em FOCUS_NFE_WEBHOOK_SECRET no .env). Se não definido, aceita
 * qualquer requisição (ok em dev/homolog, NÃO em produção).
 *
 * Spec de payload do Focus:
 *   {
 *     "cnpj_emitente": "...",
 *     "ref": "...",
 *     "status": "autorizado" | "cancelado" | "erro_autorizacao" | ...,
 *     "url": "/v2/nfse/abc123",
 *     "numero": "12345",
 *     "protocolo": "..."
 *   }
 */

interface FocusNfeWebhookPayload {
  cnpj_emitente?: string;
  cnpj?: string;
  ref?: string;
  status?: string;
  url?: string;
  numero?: string;
  numero_nfse?: string;
  codigo_verificacao?: string;
  protocolo?: string;
  data_emissao?: string;
  caminho_xml_nota_fiscal?: string;
  caminho_xml_cancelamento?: string;
  modelo?: string;
  // O Focus pode enviar campos extras dependendo do tipo (NFSe vs NFe)
  [k: string]: any;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class FocusNfeWebhookController {
  private readonly logger = new Logger(FocusNfeWebhookController.name);
  constructor(private prisma: PrismaService) {}

  @Post('focus-nfe')
  async handle(
    @Body() payload: FocusNfeWebhookPayload,
    @Headers('x-focus-webhook-secret') secretHeader?: string,
  ) {
    // Verificação do shared secret (se configurado)
    const expectedSecret = process.env.FOCUS_NFE_WEBHOOK_SECRET;
    if (expectedSecret && secretHeader !== expectedSecret) {
      throw new UnauthorizedException('Webhook secret inválido.');
    }

    const ref = payload?.ref;
    if (!ref) {
      this.logger.warn(`Webhook Focus NFe sem ref: ${JSON.stringify(payload).slice(0, 300)}`);
      throw new BadRequestException('Payload sem campo "ref".');
    }

    this.logger.log(`Webhook Focus NFe ref=${ref} status=${payload.status}`);

    // Encontra o FiscalDocument pelo ref armazenado em provider_document_id
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { provider_document_id: ref },
    });
    if (!doc) {
      this.logger.warn(`FiscalDocument com ref=${ref} não encontrado — ignorando.`);
      // Retorna 200 mesmo assim — Focus reenfileira em caso de erro 5xx,
      // mas se a gente devolve 4xx ele desiste. Para refs desconhecidos,
      // queremos só ignorar.
      return { ok: true, ignored: true };
    }

    const focusStatus = (payload.status ?? '').toLowerCase();
    let nextStatus: 'AUTHORIZED' | 'CANCELLED' | 'REJECTED' | 'ERROR' | null = null;
    if (focusStatus === 'autorizado') nextStatus = 'AUTHORIZED';
    else if (focusStatus === 'cancelado') nextStatus = 'CANCELLED';
    else if (focusStatus.startsWith('erro') || focusStatus === 'rejeitado') nextStatus = 'REJECTED';

    const data: any = {
      raw_response: payload as any,
    };
    if (nextStatus) data.status = nextStatus;
    if (nextStatus === 'AUTHORIZED') data.authorization_date = new Date();
    if (nextStatus === 'CANCELLED') data.cancellation_date = new Date();
    if (payload.numero || payload.numero_nfse) data.document_number = payload.numero ?? payload.numero_nfse;
    if (payload.caminho_xml_nota_fiscal) {
      // Apenas salva o caminho relativo; o adapter pode buscar depois
      data.pdf_url = payload.caminho_xml_nota_fiscal;
    }

    await this.prisma.fiscalDocument.update({
      where: { id: doc.id },
      data,
    });

    this.logger.log(`FiscalDocument ${doc.id} atualizado para status=${nextStatus ?? 'mantido'}.`);
    return { ok: true, ref, status: nextStatus };
  }
}

@Module({
  controllers: [FocusNfeWebhookController],
  providers: [PrismaService],
})
export class WebhooksModule {}
