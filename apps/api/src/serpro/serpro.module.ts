import { Module, Controller, Get, Post, Body, Param, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Profile } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesGuard, Profiles, CurrentUser } from '../auth/current-user.decorator';
import { SerproAdapter } from './serpro.adapter';
import { ProcuradorService } from './procurador.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('serpro')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProfilesGuard)
@Controller('serpro')
export class SerproController {
  constructor(
    private serpro: SerproAdapter,
    private procurador: ProcuradorService,
    private prisma: PrismaService,
  ) {}

  /** Helper: busca o CNPJ de uma empresa por id e o do escritório (procurador) */
  private async resolveCnpjs(companyId: string) {
    const [client, office] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId } }),
      this.prisma.company.findFirst({ where: { is_office_account: true, metadeleted: false } }),
    ]);
    if (!client) throw new Error('Empresa não encontrada.');
    if (!office) throw new Error('Conta de escritório não cadastrada.');
    return {
      contratanteCnpj: office.cnpj.replace(/\D/g, ''),
      contribuinteCnpj: client.cnpj.replace(/\D/g, ''),
      clientName: client.name,
    };
  }

  /** Consulta SITFIS (situação fiscal) de uma empresa cadastrada — JSON cru. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('client/:companyId/sitfis')
  async sitfisByCompany(@Param('companyId') companyId: string) {
    const { contratanteCnpj, contribuinteCnpj } = await this.resolveCnpjs(companyId);
    return this.serpro.consultarSituacaoFiscal({ contratanteCnpj, contribuinteCnpj });
  }

  /**
   * SITFIS direto em PDF.
   * Extrai o "pdf" base64 da resposta e devolve como application/pdf
   * (visualizável inline no navegador).
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('client/:companyId/sitfis/pdf')
  async sitfisPdf(@Param('companyId') companyId: string, @Res() res: Response) {
    const { contratanteCnpj, contribuinteCnpj, clientName } = await this.resolveCnpjs(companyId);
    const result = await this.serpro.consultarSituacaoFiscal({ contratanteCnpj, contribuinteCnpj });

    let dados: any = result?.relatorio?.dados;
    if (typeof dados === 'string') {
      try { dados = JSON.parse(dados); } catch { /* mantém string */ }
    }
    const pdfBase64: string | undefined = dados?.pdf
      ?? dados?.PDFRelatorio
      ?? dados?.pdfRelatorio
      ?? dados?.relatorio
      ?? (typeof dados === 'string' ? dados : undefined);

    if (!pdfBase64) {
      throw new BadRequestException(
        `Resposta da Receita não contém PDF. Conteúdo: ${JSON.stringify(result).slice(0, 300)}`,
      );
    }
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const safeName = clientName.replace(/[^a-z0-9-_]/gi, '_').slice(0, 40);
    const filename = `sitfis_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    // Desabilita cache/ETag — sem isso o Express manda 304 no segundo clique
    // e axios responseType=blob falha ao processar resposta vazia.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.removeHeader('ETag');
    res.end(pdfBuffer);
  }

  /**
   * Lista todas as procurações eCAC ativas do escritório.
   * Não exige um cliente específico — retorna TUDO que outorgaram à Valentim.
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('procuracoes')
  async listarProcuracoes() {
    const office = await this.prisma.company.findFirst({
      where: { is_office_account: true, metadeleted: false },
    });
    if (!office) throw new BadRequestException('Conta de escritório não cadastrada.');
    return this.serpro.obterProcuracoes({ contratanteCnpj: office.cnpj });
  }

  /** Caixa postal eCAC de uma empresa. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('client/:companyId/caixa-postal')
  async caixaPostal(@Param('companyId') companyId: string) {
    const { contratanteCnpj, contribuinteCnpj } = await this.resolveCnpjs(companyId);
    return this.serpro.listarCaixaPostal({ contratanteCnpj, contribuinteCnpj });
  }

  /**
   * DCTFWeb — declaração completa em PDF (mês anterior por default).
   * O Serpro devolve em "PDFByteArrayBase64".
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('client/:companyId/dctfweb/pdf')
  async dctfwebPdf(
    @Param('companyId') companyId: string,
    @Body() body: { ano?: string; mes?: string; categoria?: string } = {},
    @Res() res: Response,
  ) {
    const { contratanteCnpj, contribuinteCnpj, clientName } = await this.resolveCnpjs(companyId);
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const ano = body.ano ?? String(prev.getFullYear());
    const mes = body.mes ?? String(prev.getMonth() + 1).padStart(2, '0');

    const result = await this.serpro.consultarDctfWebDeclaracao({
      contratanteCnpj, contribuinteCnpj,
      categoria: body.categoria, anoPA: ano, mesPA: mes,
    });

    let dados: any = result?.dados;
    if (typeof dados === 'string') {
      try { dados = JSON.parse(dados); } catch { /* mantém */ }
    }
    const pdfBase64: string | undefined = dados?.PDFByteArrayBase64
      ?? dados?.pdfByteArrayBase64
      ?? dados?.pdf;

    if (!pdfBase64) {
      throw new BadRequestException(
        `Sem PDF na resposta DCTFWeb. Conteúdo: ${JSON.stringify(result).slice(0, 300)}`,
      );
    }
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const safeName = clientName.replace(/[^a-z0-9-_]/gi, '_').slice(0, 40);
    const filename = `dctfweb_${safeName}_${ano}-${mes}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.removeHeader('ETag');
    res.end(pdfBuffer);
  }

  /**
   * DCTFWeb — declaração completa do mês anterior (default).
   * Pode passar ?ano=2026&mes=03 ou ?categoria=GERAL_MENSAL.
   */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('client/:companyId/dctfweb')
  async dctfwebDeclaracao(
    @Param('companyId') companyId: string,
    @Body() body?: { ano?: string; mes?: string; categoria?: string },
  ) {
    const { contratanteCnpj, contribuinteCnpj } = await this.resolveCnpjs(companyId);
    // Default = mês anterior (este mês a DCTFWeb pode ainda estar em aberto)
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const ano = body?.ano ?? String(prev.getFullYear());
    const mes = body?.mes ?? String(prev.getMonth() + 1).padStart(2, '0');
    return this.serpro.consultarDctfWebDeclaracao({
      contratanteCnpj, contribuinteCnpj,
      categoria: body?.categoria, anoPA: ano, mesPA: mes,
    });
  }

  /** Autentica o escritório como procurador no eCAC (gera jwt_token). */
  @Profiles(Profile.ADMIN)
  @Post('procurador/autenticar')
  autenticarProcurador(@Body() body: { password?: string }) {
    return this.procurador.autenticarProcurador({ password: body?.password });
  }

  /** Status atual do JWT em cache. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Get('procurador/status')
  procuradorStatus() {
    return this.procurador.getCacheStatus();
  }

  /** Encerra a sessão do procurador (limpa JWT em cache + banco). */
  @Profiles(Profile.ADMIN)
  @Post('procurador/desconectar')
  async procuradorDesconectar() {
    await this.procurador.clearCache();
    return { ok: true };
  }

  /** Health-check — gera token e confirma se as credenciais estão válidas. */
  @Profiles(Profile.ADMIN)
  @Get('health')
  health() {
    return this.serpro.healthCheck();
  }

  /**
   * Discovery — testa cada sistema do Integra Contador e retorna quais estão
   * contratados / precisam de eCAC / negados. Use o CNPJ do contratante (do .env).
   */
  @Profiles(Profile.ADMIN)
  @Get('discovery')
  discovery() {
    const cnpj = process.env.SERPRO_CONTRATANTE_CNPJ;
    if (!cnpj) {
      return { error: 'SERPRO_CONTRATANTE_CNPJ não configurado no .env' };
    }
    return this.serpro.discoverContractedSystems(cnpj);
  }

  /** Consulta situação fiscal de PJ (com base nos CNPJs do contratante e contribuinte). */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('sitfis')
  sitfis(@Body() body: { contratanteCnpj: string; contribuinteCnpj: string }) {
    return this.serpro.consultarSituacaoFiscal(body);
  }

  /** Consulta DCTFWeb de um período específico. */
  @Profiles(Profile.ADMIN, Profile.MANAGER)
  @Post('dctfweb/declaracao')
  dctfweb(@Body() body: { contratanteCnpj: string; contribuinteCnpj: string; anoPA: string; mesPA: string; categoria?: string }) {
    return this.serpro.consultarDctfWebDeclaracao(body);
  }
}

@Module({
  controllers: [SerproController],
  providers: [SerproAdapter, ProcuradorService, PrismaService],
  exports: [SerproAdapter, ProcuradorService],
})
export class SerproModule {}
