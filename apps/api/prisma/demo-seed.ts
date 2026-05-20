/**
 * Demo seed — popula o banco com 2 empresas modelo prontas para apresentação:
 *
 *  1) Apostas Real S.A.       — Lucro Real, ~R$ 35 mi/mês de GGR e ~R$ 30 mi/mês de despesas
 *  2) JogaFácil Apostas LTDA  — Lucro Presumido, ~R$ 6 mi/mês de GGR e ~R$ 4,5 mi/mês de despesas
 *
 * Cada empresa recebe:
 *   - Tax config compatível com o regime
 *   - 16 naturezas contábeis padrão
 *   - 1 marca (brand)
 *   - 2 contas bancárias (1 player_wallet + 1 operacional)
 *   - 1 usuário MANAGER para login direto
 *   - 90 dias de registros diários (GgrDailyRecord) com volumes oscilando
 *   - ~90 contas a pagar PAID distribuídas pelas naturezas
 *
 * Idempotente: pula empresas que já existirem (compara por CNPJ).
 *
 * Execução:  cd apps/api && npm run seed:demo
 */

import {
  PrismaClient, Profile, Status, TaxRegime, PisCofinsRegime, IrpjApurationPeriod,
  IssCalculationBase, BankAccountType, GgrSourceType, PaymentStatus, PayableSource,
  StatementStatus, StatementLineStatus, StatementLineType, GgrApurationStatus,
  TaxApurationStatus, IrpjApurationStatus, AuditAlertLevel, AuditCheckType,
  FiscalProviderType, FiscalDocumentType, FiscalDocumentDirection, FiscalDocumentStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { seedDefaultNaturesForCompany } from '../src/financial/financial-natures/default-natures';
import { syncDefaultChartOfAccountsForCompany } from '../src/financial/chart-of-accounts/default-accounts';
import { JournalPostingService } from '../src/accounting/journal-posting.service';
import { suggestIssRate } from '../src/tax/iss-rates';

const prisma = new PrismaClient();
const posting = new JournalPostingService(prisma as any);

// ============= Helpers =============

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const DAYS = 90;
function rand() { return Math.random(); }
function jitter(base: number, pct: number) {
  // varia ±pct (ex.: 0.2 = ±20%)
  return base * (1 + (rand() * 2 - 1) * pct);
}
function reais(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

interface CompanyProfile {
  name: string;
  cnpj: string;
  city: string;
  state: string;
  brand_name: string;
  brand_domain: string;
  manager_username: string;
  tax_regime: TaxRegime;
  pis_cofins_regime: PisCofinsRegime;
  apuration_period: IrpjApurationPeriod;
  // Volumes mensais alvo (em R$ — não centavos)
  monthly_ggr: number;             // soma de (apostas - prêmios)
  monthly_deposits: number;
  monthly_withdrawals: number;
  monthly_deposit_count: number;
  monthly_withdrawal_count: number;
  monthly_active_players: number;
  monthly_expenses: number;        // total de contas a pagar / mês
}

const PROFILES: CompanyProfile[] = [
  {
    name: 'Apostas Real S.A.',
    cnpj: '12.345.678/0001-99',
    city: 'São Paulo',
    state: 'SP',
    brand_name: 'BetReal',
    brand_domain: 'betreal.com.br',
    manager_username: 'manager.real',
    tax_regime: TaxRegime.LUCRO_REAL,
    pis_cofins_regime: PisCofinsRegime.NAO_CUMULATIVO,
    apuration_period: IrpjApurationPeriod.TRIMESTRAL,
    monthly_ggr:                35_000_000,
    monthly_deposits:          120_000_000,
    monthly_withdrawals:        95_000_000,
    monthly_deposit_count:           5_000,
    monthly_withdrawal_count:        4_000,
    monthly_active_players:         18_000,
    monthly_expenses:           23_800_000, // 68% do GGR
  },
  {
    name: 'JogaFácil Apostas LTDA',
    cnpj: '98.765.432/0001-11',
    city: 'Belo Horizonte',
    state: 'MG',
    brand_name: 'JogaFácil',
    brand_domain: 'jogafacil.bet.br',
    manager_username: 'manager.presumido',
    tax_regime: TaxRegime.LUCRO_PRESUMIDO,
    pis_cofins_regime: PisCofinsRegime.CUMULATIVO,
    apuration_period: IrpjApurationPeriod.TRIMESTRAL,
    monthly_ggr:                 6_000_000,
    monthly_deposits:           22_000_000,
    monthly_withdrawals:        18_000_000,
    monthly_deposit_count:           1_500,
    monthly_withdrawal_count:        1_200,
    monthly_active_players:          4_000,
    monthly_expenses:            4_080_000, // 68% do GGR
  },
];

// Distribuição de despesas (% do total mensal) por natureza.
//
// Total = 100% (já não inclui tributos sobre receita — Lei 14.790 e PIS/COFINS
// vêm como DARFs gerados pelas apurações tributárias, não como contas a pagar
// avulsas).
//
// is_insumo = TRUE marca despesas que são insumos da atividade-fim e geram
// crédito de PIS/COFINS no regime NÃO-CUMULATIVO (Lucro Real). Para empresas
// no regime CUMULATIVO (Lucro Presumido) o flag é ignorado — não há crédito.
// is_pj_service = TRUE → fornecedor é PJ e o serviço se enquadra na lista
// taxativa do art. 647 da Lei 9.430/96 (consultoria, marketing, TI, etc.).
// Nesses casos, aplicamos retenções federais CSRF (IRRF + CSLL + PIS + COFINS).
const EXPENSE_DISTRIBUTION: Array<{
  nature: string; pct: number; supplier: string; description: string;
  is_insumo: boolean; is_pj_service: boolean;
}> = [
  { nature: 'Despesas com Pessoal',              pct: 0.20, is_insumo: false, is_pj_service: false, supplier: 'Folha de Pagamento',     description: 'Folha mensal — salários e encargos' },
  { nature: 'Despesas Administrativas',          pct: 0.08, is_insumo: true,  is_pj_service: false, supplier: 'Imobiliária Centro',     description: 'Aluguel + condomínio + energia + internet (sede)' },
  { nature: 'Despesas Comerciais e Marketing',   pct: 0.30, is_insumo: false, is_pj_service: true,  supplier: 'AdsBet Mídia Digital',   description: 'Mídia paga (Google/Meta) + afiliados' },
  { nature: 'Despesas Tecnológicas',             pct: 0.25, is_insumo: true,  is_pj_service: true,  supplier: 'PlayTech Platform LTDA', description: 'Plataforma de apostas + gateways + KYC + licenças' },
  { nature: 'Despesas Tributárias Operacionais', pct: 0.04, is_insumo: false, is_pj_service: false, supplier: 'Prefeitura / Sefaz',     description: 'Taxas, alvarás e contribuições' },
  { nature: 'Despesas Financeiras',              pct: 0.08, is_insumo: false, is_pj_service: false, supplier: 'Banco Itaú S.A.',        description: 'Tarifas bancárias + IOF' },
  { nature: 'Despesas Não Operacionais',         pct: 0.05, is_insumo: false, is_pj_service: false, supplier: 'Diversos',               description: 'Multas, perdas e despesas eventuais' },
];

// Alíquotas para crédito PIS/COFINS no regime NÃO-CUMULATIVO
const PIS_CREDIT_RATE    = 0.0165; // 1,65%
const COFINS_CREDIT_RATE = 0.076;  // 7,60%

// Alíquotas CSRF (retenção PJ→PJ — Lei 9.430/96 + IN RFB 459/04)
const CSRF_IRRF   = 0.015;
const CSRF_CSLL   = 0.010;
const CSRF_PIS    = 0.0065;
const CSRF_COFINS = 0.030;

// ============= Seed por empresa =============

async function seedCompany(p: CompanyProfile) {
  const existing = await prisma.company.findUnique({ where: { cnpj: p.cnpj } });
  if (existing) {
    if (process.env.DEMO_RESET === 'true') {
      console.log(`♻️  Limpando dados antigos de ${p.name} (DEMO_RESET=true)…`);
      const cid = existing.id;
      // Auditoria
      await prisma.auditAlert.deleteMany({ where: { company_id: cid } });
      await prisma.auditMovementsCheck.deleteMany({ where: { company_id: cid } });
      await prisma.auditFeesCheck.deleteMany({ where: { company_id: cid } });
      await prisma.auditTaxesCheck.deleteMany({ where: { company_id: cid } });
      // Fiscal
      await prisma.fiscalDocument.deleteMany({ where: { company_id: cid } });
      await prisma.fiscalCertificate.deleteMany({ where: { company_id: cid } });
      await prisma.fiscalSyncLog.deleteMany({ where: { company_id: cid } });
      await prisma.fiscalProvider.deleteMany({ where: { company_id: cid } });
      // Lançamentos contábeis
      await prisma.journalEntryLine.deleteMany({ where: { entry: { company_id: cid } } });
      await prisma.journalEntry.deleteMany({ where: { company_id: cid } });
      // Financeiro
      await prisma.transaction.deleteMany({ where: { company_id: cid } });
      await prisma.accountPayable.deleteMany({ where: { company_id: cid } });
      await prisma.accountReceivable.deleteMany({ where: { company_id: cid } });
      // Apurações
      await prisma.lalurAdjustment.deleteMany({ where: { company_id: cid } });
      await prisma.irpjCsllApuration.deleteMany({ where: { company_id: cid } });
      await prisma.pisCofinsApuration.deleteMany({ where: { company_id: cid } });
      await prisma.issApuration.deleteMany({ where: { company_id: cid } });
      await prisma.ggrMonthlyApuration.deleteMany({ where: { company_id: cid } });
      // Bank stuff
      await prisma.bankStatement.deleteMany({ where: { company_id: cid } });
      await prisma.bankConnection.deleteMany({ where: { company_id: cid } });
      await prisma.bankIntegration.deleteMany({ where: { company_id: cid } });
      // GGR
      await prisma.ggrDailyRecord.deleteMany({ where: { company_id: cid } });
      await prisma.dataSource.deleteMany({ where: { company_id: cid } });
      // Cadastros
      await prisma.bankAccount.deleteMany({ where: { company_id: cid } });
      await prisma.contact.deleteMany({ where: { company_id: cid } });
      await prisma.user.deleteMany({ where: { company_id: cid } });
      await prisma.financialCategory.deleteMany({ where: { company_id: cid } });
      await prisma.financialNature.deleteMany({ where: { company_id: cid } });
      await prisma.chartOfAccount.deleteMany({ where: { company_id: cid } });
      await prisma.brand.deleteMany({ where: { company_id: cid } });
      await prisma.companyTaxConfig.deleteMany({ where: { company_id: cid } });
      await prisma.company.delete({ where: { id: cid } });
    } else {
      console.log(`⏭️  ${p.name} já existe (CNPJ ${p.cnpj}) — pulando. Use DEMO_RESET=true para recriar.`);
      return;
    }
  }

  console.log(`\n🏢 Criando ${p.name} (${p.tax_regime})...`);

  // 1. Empresa
  const company = await prisma.company.create({
    data: {
      name: p.name,
      cnpj: p.cnpj,
      city: p.city,
      state: p.state,
      tax_regime: p.tax_regime,
    },
  });

  // 2. Tax config
  // ISS por município (lookup automático na tabela de alíquotas)
  const issSuggestion = suggestIssRate(p.city, p.state);
  await prisma.companyTaxConfig.create({
    data: {
      company_id: company.id,
      tax_regime: p.tax_regime,
      pis_cofins_regime: p.pis_cofins_regime,
      apuration_period: p.apuration_period,
      iss_rate: issSuggestion.rate,
      iss_calculation_base: IssCalculationBase.GGR,
    },
  });

  // 3. Naturezas padrão (16) + Plano de Contas padrão
  const natRes = await seedDefaultNaturesForCompany(prisma, company.id);
  const chartRes = await syncDefaultChartOfAccountsForCompany(prisma, company.id);
  console.log(`   ✓ ${natRes.created} naturezas + ${chartRes.created} contas contábeis criadas.`);

  // Index das naturezas por nome (para usar em payables)
  const natures = await prisma.financialNature.findMany({ where: { company_id: company.id, metadeleted: false } });
  const natByName = new Map(natures.map(n => [n.name, n.id]));

  // 4. Marca
  const brand = await prisma.brand.create({
    data: {
      name: p.brand_name,
      domain: p.brand_domain,
      company_id: company.id,
      description: `Marca operacional principal da ${p.name}.`,
    },
  });

  // 5. Manager
  const password_hash = await bcrypt.hash('123456', 10);
  await prisma.user.create({
    data: {
      name: `Gestor ${p.brand_name}`,
      username: p.manager_username,
      email: `${p.manager_username}@${p.brand_domain}`,
      password_hash,
      profile: Profile.MANAGER,
      status: Status.ACTIVE,
      company_id: company.id,
    },
  });
  console.log(`   ✓ Manager: ${p.manager_username} / 123456`);

  // 6. Contas bancárias (1 player_wallet + 1 operacional)
  const playerWallet = await prisma.bankAccount.create({
    data: {
      name: `${p.brand_name} — Conta Apostadores`,
      type: BankAccountType.CHECKING,
      bank_name: 'Banco Itaú S.A.',
      bank_code: '341',
      agency: '0001',
      account_number: '12345-6',
      initial_balance: 0n,
      current_balance: reais(p.monthly_deposits * 0.4), // saldo de carteira
      company_id: company.id,
      is_player_wallet: true,
      fee_per_credit: reais(0.50),  // R$ 0,50 por depósito recebido
      fee_per_debit:  reais(2.50),  // R$ 2,50 por saque emitido (PIX out)
      description: 'Conta transacional dos apostadores (Lei 14.790 art. 5º).',
    },
  });
  const operationalAccount = await prisma.bankAccount.create({
    data: {
      name: `${p.brand_name} — Conta Operacional`,
      type: BankAccountType.CHECKING,
      bank_name: 'Banco do Brasil S.A.',
      bank_code: '001',
      agency: '1234',
      account_number: '99999-0',
      initial_balance: reais(p.monthly_expenses * 0.5),
      current_balance: reais(p.monthly_expenses * 0.5),
      company_id: company.id,
      is_player_wallet: false,
      description: 'Conta operacional (despesas, folha, fornecedores).',
    },
  });

  // 7. 90 dias de GgrDailyRecord
  const dailyGgr        = p.monthly_ggr / 30;
  const dailyDeposits   = p.monthly_deposits / 30;
  const dailyWithdrawals= p.monthly_withdrawals / 30;
  const dailyDepCount   = p.monthly_deposit_count / 30;
  const dailyWdCount    = p.monthly_withdrawal_count / 30;
  const dailyPlayers    = p.monthly_active_players / 30;
  const ggrMargin = 0.10; // GGR é 10% das apostas → apostas = GGR/0.10

  const ggrRows: any[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(TODAY);
    date.setDate(TODAY.getDate() - (DAYS - i));

    const ggr        = jitter(dailyGgr, 0.25);
    const totalBets  = ggr / ggrMargin;
    const totalPrizes= totalBets - ggr;
    const deposits   = jitter(dailyDeposits, 0.20);
    const withdrawals= jitter(dailyWithdrawals, 0.22);
    const depCount   = Math.round(jitter(dailyDepCount, 0.18));
    const wdCount    = Math.round(jitter(dailyWdCount, 0.18));
    const players    = Math.round(jitter(dailyPlayers, 0.15));
    // Gamificação: ~5% do GGR distribuído como bônus/cashback/freebets (varia ±30%)
    const bonus      = jitter(ggr * 0.05, 0.30);

    ggrRows.push({
      date,
      total_bets: reais(totalBets),
      total_prizes: reais(totalPrizes),
      total_deposits: reais(deposits),
      total_withdrawals: reais(withdrawals),
      total_bonus: reais(bonus),
      bet_count: depCount * 30,            // muitas apostas por jogador
      prize_count: Math.round(depCount * 12),
      deposit_count: depCount,
      withdrawal_count: wdCount,
      active_players: players,
      ggr: reais(ggr),
      source_type: GgrSourceType.MANUAL,
      brand_id: brand.id,
      company_id: company.id,
    });
  }
  await prisma.ggrDailyRecord.createMany({ data: ggrRows });
  console.log(`   ✓ ${DAYS} GgrDailyRecord (≈ R$ ${(p.monthly_ggr / 1_000_000).toFixed(1)} mi/mês de GGR)`);

  // 8. Contas a pagar — ~3 entradas por natureza por mês × 3 meses
  const months = 3;
  const payableRows: any[] = [];
  const isNaoCumulativo = p.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO;
  let insumoTotal = 0;
  for (let m = 0; m < months; m++) {
    for (const dist of EXPENSE_DISTRIBUTION) {
      if (dist.pct === 0) continue;
      const natureId = natByName.get(dist.nature);
      if (!natureId) continue;

      const monthlyForNature = p.monthly_expenses * dist.pct;
      // Quebra em 2 a 4 lançamentos para ficar realista
      const installments = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < installments; k++) {
        const amount = jitter(monthlyForNature / installments, 0.15);
        const issue = new Date(TODAY);
        issue.setMonth(TODAY.getMonth() - m - 1);
        issue.setDate(1 + Math.floor(rand() * 25));
        const due = new Date(issue);
        due.setDate(issue.getDate() + 5 + Math.floor(rand() * 15));
        const payDate = new Date(due);
        payDate.setDate(due.getDate() - Math.floor(rand() * 3));

        // Crédito PIS/COFINS: apenas insumos × regime não-cumulativo (Lucro Real)
        const generatesCredit = dist.is_insumo && isNaoCumulativo;
        const pisCredit    = generatesCredit ? amount * PIS_CREDIT_RATE    : 0;
        const cofinsCredit = generatesCredit ? amount * COFINS_CREDIT_RATE : 0;
        if (generatesCredit) insumoTotal += amount;

        // Retenções CSRF (PJ→PJ): IRRF + CSLL + PIS + COFINS (6,15% total)
        const isPj = dist.is_pj_service;
        const irrfRet   = isPj ? amount * CSRF_IRRF   : 0;
        const csllRet   = isPj ? amount * CSRF_CSLL   : 0;
        const pisRet    = isPj ? amount * CSRF_PIS    : 0;
        const cofinsRet = isPj ? amount * CSRF_COFINS : 0;
        const totalRet  = irrfRet + csllRet + pisRet + cofinsRet;
        // Líquido efetivamente pago ao fornecedor = bruto - retenções
        const netPaid = amount - totalRet;

        payableRows.push({
          description: `${dist.description} — parc. ${k + 1}/${installments}`,
          supplier_name: dist.supplier,
          amount: reais(amount),
          paid_amount: reais(netPaid),
          issue_date: issue,
          due_date: due,
          payment_date: payDate,
          status: PaymentStatus.PAID,
          source: PayableSource.MANUAL,
          is_deductible_expense: dist.nature !== 'Despesas Não Operacionais',
          generates_pis_cofins_credit: generatesCredit,
          pis_credit_amount: reais(pisCredit),
          cofins_credit_amount: reais(cofinsCredit),
          is_service_from_pj: isPj,
          irrf_retained:   reais(irrfRet),
          csll_retained:   reais(csllRet),
          pis_retained:    reais(pisRet),
          cofins_retained: reais(cofinsRet),
          company_id: company.id,
          brand_id: brand.id,
          nature_id: natureId,
        });
      }
    }
  }
  await prisma.accountPayable.createMany({ data: payableRows });
  const totalExpensesCreated = payableRows.reduce((s, r) => s + Number(r.amount), 0) / 100;
  const totalRetainedCreated = payableRows.reduce((s, r) =>
    s + Number(r.irrf_retained ?? 0) + Number(r.csll_retained ?? 0)
      + Number(r.pis_retained ?? 0) + Number(r.cofins_retained ?? 0), 0) / 100;
  const pjPayables = payableRows.filter(r => r.is_service_from_pj);
  const ggrPct = (totalExpensesCreated / months / p.monthly_ggr * 100).toFixed(1);
  let log = `   ✓ ${payableRows.length} contas a pagar (≈ R$ ${(totalExpensesCreated / months / 1_000_000).toFixed(2)} mi/mês = ${ggrPct}% do GGR)`;
  if (isNaoCumulativo) {
    const insumoMonthly = insumoTotal / months;
    const pisCred    = insumoMonthly * PIS_CREDIT_RATE;
    const cofinsCred = insumoMonthly * COFINS_CREDIT_RATE;
    log += `\n     · Insumos PIS/COFINS: R$ ${(insumoMonthly / 1_000_000).toFixed(2)} mi/mês → créditos PIS R$ ${(pisCred / 1_000).toFixed(1)}k + COFINS R$ ${(cofinsCred / 1_000).toFixed(1)}k`;
  }
  log += `\n     · Retenções CSRF (PJ→PJ): ${pjPayables.length} pagamentos, total retido R$ ${(totalRetainedCreated / months / 1_000).toFixed(1)}k/mês`;
  console.log(log);

  // 9. Extratos bancários da player_wallet (3 meses, 1 statement por mês)
  await seedBankStatements(company.id, playerWallet.id, ggrRows);

  // 9b. DARFs de retenção CSRF (1 por mês × 4 tributos = obrigação à Receita Federal)
  await seedWithholdingDarfs(company.id, brand.id);

  // 10. Apurações fechadas (3 meses) + DARFs PAGOS
  await seedApurationsAndDarfs(company, brand.id, ggrRows, p);

  // 11. NFSe emitidas (sample dos 5 maiores dias)
  await seedFiscalDocuments(company, brand.id, ggrRows);

  // 12. Snapshots de auditoria — popula a tela /audit/history
  await seedAuditSnapshots(company.id, brand.id, playerWallet.id, ggrRows, p);

  // 13. Lançamentos contábeis (Journal Entries):
  //     - Cria Transactions para cada payable PAID (saída do banco)
  //     - Dispara postPayablePaid → registra D Despesa / C Banco / C Retenções (CSRF)
  //     - Dispara postGgrDaily para cada GGR record (D Banco Segregado / C Saldo Apostadores / GGR)
  //     - Dispara post*Close para cada apuração fechada (provisão de tributos)
  await seedJournalEntries(company.id, operationalAccount.id);

  console.log(`✅ ${p.name} pronta.`);
}

// ============================================================================
// Lançamentos contábeis — cria Transactions e dispara posting service
// ============================================================================

async function seedJournalEntries(companyId: string, operationalAccountId: string) {
  // Transactions para payables PAID
  const paidPayables = await prisma.accountPayable.findMany({
    where: { company_id: companyId, metadeleted: false, status: PaymentStatus.PAID, duplicate_of_id: null },
    select: { id: true, brand_id: true, paid_amount: true, payment_date: true, description: true, category_id: true, account_id: true },
  });
  for (const p of paidPayables) {
    if (!p.payment_date) continue;
    await prisma.transaction.create({
      data: {
        description: `Pagamento: ${p.description}`,
        amount: p.paid_amount,
        type: 'EXPENSE',
        date: p.payment_date,
        company_id: companyId,
        brand_id: p.brand_id,
        bank_account_id: operationalAccountId,
        category_id: p.category_id,
        account_id: p.account_id,
        payable_id: p.id,
        notes: 'Transação gerada automaticamente pelo demo-seed',
      },
    });
  }

  // Posting de cada payable PAID (D despesa / C banco + retenções)
  let postedPay = 0, errPay = 0;
  for (const p of paidPayables) {
    try { await posting.postPayablePaid(p.id); postedPay++; } catch { errPay++; }
  }

  // Posting do GGR diário (D banco segregado / C saldo apostadores; D saldo / C GGR)
  const ggrIds = await prisma.ggrDailyRecord.findMany({
    where: { company_id: companyId, metadeleted: false }, select: { id: true },
  });
  let postedGgr = 0;
  for (const g of ggrIds) {
    try { await posting.postGgrDaily(g.id); postedGgr++; } catch {}
  }

  // Posting das apurações fechadas (provisão de tributos)
  let postedTax = 0;
  const ggrApurs = await prisma.ggrMonthlyApuration.findMany({
    where: { company_id: companyId, metadeleted: false }, select: { id: true },
  });
  for (const a of ggrApurs) { try { await posting.postGgrApurationTaxes(a.id); postedTax++; } catch {} }

  const pisCofinsApurs = await prisma.pisCofinsApuration.findMany({
    where: { company_id: companyId, metadeleted: false }, select: { id: true },
  });
  for (const a of pisCofinsApurs) { try { await posting.postPisCofinsClose(a.id); postedTax++; } catch {} }

  const issApurs = await prisma.issApuration.findMany({
    where: { company_id: companyId, metadeleted: false }, select: { id: true },
  });
  for (const a of issApurs) { try { await posting.postIssClose(a.id); postedTax++; } catch {} }

  const irpjApurs = await prisma.irpjCsllApuration.findMany({
    where: { company_id: companyId, metadeleted: false }, select: { id: true },
  });
  for (const a of irpjApurs) { try { await posting.postIrpjCsllClose(a.id); postedTax++; } catch {} }

  console.log(`   ✓ Lançamentos contábeis: ${postedPay} payables + ${postedGgr} GGR diários + ${postedTax} apurações${errPay ? ` (${errPay} erros)` : ''}`);
}

// ============================================================================
// Extratos bancários
// ============================================================================

// ============================================================================
// DARFs de Retenção CSRF — 1 por (mês × tributo) consolidando retenções de
// todos os pagamentos PJ→PJ do período. Vencimento: dia 20 do mês seguinte
// (regra prática para CSRF — códigos de receita 1708/5979/5960/5952).
// ============================================================================

async function seedWithholdingDarfs(companyId: string, brandId: string) {
  // Agrupa retenções do mês a partir dos payables PJ→PJ já criados
  const pjPayables = await prisma.accountPayable.findMany({
    where: { company_id: companyId, metadeleted: false, is_service_from_pj: true },
    select: {
      issue_date: true,
      irrf_retained: true, csll_retained: true,
      pis_retained: true, cofins_retained: true,
    },
  });

  type Bucket = { irrf: bigint; csll: bigint; pis: bigint; cofins: bigint };
  const byMonth = new Map<string, Bucket & { year: number; month: number }>();
  for (const r of pjPayables) {
    const y = r.issue_date.getFullYear();
    const m = r.issue_date.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!byMonth.has(key)) {
      byMonth.set(key, { year: y, month: m, irrf: 0n, csll: 0n, pis: 0n, cofins: 0n });
    }
    const b = byMonth.get(key)!;
    b.irrf   += BigInt(r.irrf_retained);
    b.csll   += BigInt(r.csll_retained);
    b.pis    += BigInt(r.pis_retained);
    b.cofins += BigInt(r.cofins_retained);
  }

  // Códigos de receita Receita Federal (CSRF):
  //   1708  IRRF s/ Serviços PJ
  //   5979  CSLL Retida na Fonte
  //   5979  PIS Retido na Fonte (mesmo grupo)
  //   5960  COFINS Retido na Fonte
  // Em DARFs separados — 4 obrigações por mês.
  const tributos = [
    { key: 'irrf' as const,   label: 'IRRF',   codigo: '1708' },
    { key: 'csll' as const,   label: 'CSLL',   codigo: '5987' },
    { key: 'pis' as const,    label: 'PIS',    codigo: '5979' },
    { key: 'cofins' as const, label: 'COFINS', codigo: '5960' },
  ];

  const rows: any[] = [];
  for (const [, b] of byMonth) {
    const periodLabel = `${String(b.month).padStart(2, '0')}/${b.year}`;
    // Vencimento: 20 do mês seguinte (regra prática). Se já passou, marca PAGO.
    const dueDate = new Date(Date.UTC(b.year, b.month, 20));
    const issueDate = new Date(Date.UTC(b.year, b.month - 1, 28));
    const isOverdue = dueDate < TODAY;
    const payDate = isOverdue ? new Date(Date.UTC(b.year, b.month, 18)) : null;

    for (const t of tributos) {
      const amount = b[t.key];
      if (amount === 0n) continue;
      rows.push({
        description: `DARF Retenção CSRF — ${t.label} — ${periodLabel} (cód. ${t.codigo})`,
        supplier_name: 'Receita Federal do Brasil',
        amount,
        paid_amount: isOverdue ? amount : 0n,
        issue_date: issueDate,
        due_date: dueDate,
        payment_date: payDate,
        status: isOverdue ? PaymentStatus.PAID : PaymentStatus.PENDING,
        source: PayableSource.TAX_APURATION,
        is_deductible_expense: false,
        generates_pis_cofins_credit: false,
        company_id: companyId,
        brand_id: brandId,
        notes: 'DARF mensal consolidado das retenções na fonte sobre serviços tomados de PJ.',
      });
    }
  }

  if (rows.length > 0) {
    await prisma.accountPayable.createMany({ data: rows });
  }
  const paid = rows.filter(r => r.status === PaymentStatus.PAID).length;
  const pending = rows.length - paid;
  const totalCsrfDarf = rows.reduce((s, r) => s + Number(r.amount), 0) / 100;
  console.log(`   ✓ ${rows.length} DARFs de retenção CSRF (${paid} pagos · ${pending} pendentes), total R$ ${(totalCsrfDarf / 1_000).toFixed(1)}k`);
}

async function seedBankStatements(companyId: string, accountId: string, ggrRows: any[]) {
  // Agrupa GGR rows por mês
  const byMonth = new Map<string, any[]>();
  for (const r of ggrRows) {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(r);
  }

  let totalLines = 0;
  for (const [monthKey, rows] of byMonth) {
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    const startDate = rows[0].date;
    const endDate = rows[rows.length - 1].date;

    // Drift pequeno (±0.5%) para ficar OK na auditoria — mas não exato
    const driftFactor = 1 + (rand() * 0.01 - 0.005);

    let initialBalance = 0n;
    let runningBalance = 0n;

    const lines: any[] = [];
    for (const r of rows) {
      const credit = BigInt(Math.round(Number(r.total_deposits) * driftFactor));
      const debit  = BigInt(Math.round(Number(r.total_withdrawals) * driftFactor));

      // Linha de depósitos consolidada do dia
      lines.push({
        date: r.date,
        description: `PIX recebido — depósitos do dia (consolidado)`,
        amount: credit,
        type: StatementLineType.CREDIT,
        status: StatementLineStatus.MATCHED,
        fit_id: `DEP-${monthKey}-${r.date.getDate()}`,
      });
      // Linha de saques consolidada do dia
      lines.push({
        date: r.date,
        description: `PIX enviado — saques do dia (consolidado)`,
        amount: debit,
        type: StatementLineType.DEBIT,
        status: StatementLineStatus.MATCHED,
        fit_id: `WD-${monthKey}-${r.date.getDate()}`,
      });
      runningBalance += credit - debit;

      // Tarifas: 1 linha agregada de tarifas no dia (R$0,50 × dep_count + R$2,50 × wd_count)
      const dayFees = BigInt(r.deposit_count) * 50n + BigInt(r.withdrawal_count) * 250n;
      if (dayFees > 0n) {
        lines.push({
          date: r.date,
          description: `Tarifa PIX — ${r.deposit_count} créditos + ${r.withdrawal_count} débitos`,
          amount: dayFees,
          type: StatementLineType.DEBIT,
          status: StatementLineStatus.MATCHED,
          fit_id: `FEE-${monthKey}-${r.date.getDate()}`,
        });
        runningBalance -= dayFees;
      }
    }

    const statement = await prisma.bankStatement.create({
      data: {
        filename: `extrato-${monthKey}.ofx`,
        file_format: 'OFX',
        start_date: startDate,
        end_date: endDate,
        initial_balance: initialBalance,
        final_balance: runningBalance,
        status: StatementStatus.RECONCILED,
        total_lines: lines.length,
        matched_lines: lines.length,
        company_id: companyId,
        bank_account_id: accountId,
      },
    });
    await prisma.bankStatementLine.createMany({
      data: lines.map(l => ({ ...l, statement_id: statement.id })),
    });
    totalLines += lines.length;
  }

  console.log(`   ✓ ${byMonth.size} extratos bancários (${totalLines} linhas) na conta player_wallet`);
}

// ============================================================================
// Apurações fechadas + DARFs pagos
// ============================================================================

interface ApurationDarf {
  description: string;
  amount: bigint;
  apurationField: 'ggr_apuration_id' | 'irpj_apuration_id' | 'pis_cofins_apuration_id' | 'iss_apuration_id';
  apurationId: string;
}

async function seedApurationsAndDarfs(
  company: { id: string; tax_regime: TaxRegime },
  brandId: string,
  ggrRows: any[],
  p: CompanyProfile,
) {
  // Agrupa GGR por mês para totais reais
  const byMonth = new Map<string, { total_bets: bigint; total_prizes: bigint; ggr: bigint; deposits: bigint; withdrawals: bigint; year: number; month: number }>();
  for (const r of ggrRows) {
    const y = r.date.getFullYear();
    const m = r.date.getMonth() + 1;
    const key = `${y}-${m}`;
    if (!byMonth.has(key)) byMonth.set(key, {
      total_bets: 0n, total_prizes: 0n, ggr: 0n, deposits: 0n, withdrawals: 0n, year: y, month: m,
    });
    const cur = byMonth.get(key)!;
    cur.total_bets       += BigInt(r.total_bets);
    cur.total_prizes     += BigInt(r.total_prizes);
    cur.ggr              += BigInt(r.ggr);
    cur.deposits         += BigInt(r.total_deposits);
    cur.withdrawals      += BigInt(r.total_withdrawals);
  }

  const isReal = company.tax_regime === TaxRegime.LUCRO_REAL;
  const darfsToCreate: any[] = [];

  // ----- Para cada mês: GgrMonthlyApuration + Pis/Cofins + Iss -----
  for (const [, m] of byMonth) {
    const closedAt = new Date(m.year, m.month, 5); // dia 5 do mês seguinte
    const paidAt   = new Date(m.year, m.month, 18); // dia 18 do mês seguinte

    // ---- GGR Monthly: tributo Lei 14.790 (12% s/ GGR) ----
    // IRRF removido — casas de apostas não retêm IRRF dos prêmios.
    const lei14790 = (m.ggr * 12n) / 100n;
    const ggrApur = await prisma.ggrMonthlyApuration.create({
      data: {
        year: m.year, month: m.month,
        total_bets: m.total_bets, total_prizes: m.total_prizes,
        total_deposits: m.deposits, total_withdrawals: m.withdrawals,
        ggr: m.ggr, net_revenue: m.ggr - lei14790,
        tax_lei14790_rate: 12, tax_lei14790_amount: lei14790,
        pis_cofins_regime: p.pis_cofins_regime,
        total_taxes: lei14790,
        status: GgrApurationStatus.PAID,
        closed_at: closedAt, paid_at: paidAt,
        brand_id: brandId, company_id: company.id,
      },
    });
    darfsToCreate.push({
      description: `DARF Lei 14.790 — ${String(m.month).padStart(2, '0')}/${m.year}`,
      amount: lei14790, apurationField: 'ggr_apuration_id', apurationId: ggrApur.id,
    });

    // ---- PIS/COFINS Mensal ----
    const pisRate    = p.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO ? 1.65 : 0.65;
    const cofinsRate = p.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO ? 7.6  : 3.0;
    const pisAmount    = BigInt(Math.round(Number(m.ggr) * pisRate / 100));
    const cofinsAmount = BigInt(Math.round(Number(m.ggr) * cofinsRate / 100));
    // Créditos PIS/COFINS apenas no regime NÃO-CUMULATIVO (Lucro Real),
    // sobre os insumos da atividade — Despesas Tecnológicas (25%) +
    // Despesas Administrativas (8%) = 33% das despesas mensais.
    const insumoBase = isReal ? BigInt(Math.round(p.monthly_expenses * 0.33 * 100)) : 0n;
    const pisCredits    = isReal ? BigInt(Math.round(Number(insumoBase) * pisRate    / 100)) : 0n;
    const cofinsCredits = isReal ? BigInt(Math.round(Number(insumoBase) * cofinsRate / 100)) : 0n;
    const pisPayable    = pisAmount    > pisCredits    ? pisAmount    - pisCredits    : 0n;
    const cofinsPayable = cofinsAmount > cofinsCredits ? cofinsAmount - cofinsCredits : 0n;

    const pisCofinsApur = await prisma.pisCofinsApuration.create({
      data: {
        year: m.year, month: m.month,
        pis_cofins_regime: p.pis_cofins_regime,
        ggr_revenue: m.ggr, total_revenue: m.ggr,
        expenses_with_credit: insumoBase,
        pis_rate: pisRate, pis_amount: pisAmount, pis_credits: pisCredits, pis_amount_payable: pisPayable,
        cofins_rate: cofinsRate, cofins_amount: cofinsAmount, cofins_credits: cofinsCredits, cofins_amount_payable: cofinsPayable,
        total_taxes: pisPayable + cofinsPayable,
        status: TaxApurationStatus.PAID,
        closed_at: closedAt, paid_at: paidAt,
        company_id: company.id,
      },
    });
    darfsToCreate.push({
      description: `DARF PIS — ${String(m.month).padStart(2, '0')}/${m.year}`,
      amount: pisPayable, apurationField: 'pis_cofins_apuration_id', apurationId: pisCofinsApur.id,
    });
    darfsToCreate.push({
      description: `DARF COFINS — ${String(m.month).padStart(2, '0')}/${m.year}`,
      amount: cofinsPayable, apurationField: 'pis_cofins_apuration_id', apurationId: pisCofinsApur.id,
    });

    // ---- ISS Mensal (5% sobre GGR) ----
    const issAmount = (m.ggr * 5n) / 100n;
    const issApur = await prisma.issApuration.create({
      data: {
        year: m.year, month: m.month,
        calculation_base: IssCalculationBase.GGR,
        ggr_amount: m.ggr, base_amount: m.ggr,
        iss_rate: 5, iss_amount: issAmount,
        total_taxes: issAmount,
        status: TaxApurationStatus.PAID,
        closed_at: closedAt, paid_at: paidAt,
        company_id: company.id,
      },
    });
    darfsToCreate.push({
      description: `DARF ISS — ${String(m.month).padStart(2, '0')}/${m.year}`,
      amount: issAmount, apurationField: 'iss_apuration_id', apurationId: issApur.id,
    });
  }

  // ----- IRPJ/CSLL trimestral (1 trimestre fechado, cobre os 3 meses) -----
  const months = Array.from(byMonth.values()).sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
  if (months.length >= 3) {
    const q = months.slice(-3); // últimos 3 meses cobertos
    const totalGgr = q.reduce((s, x) => s + x.ggr, 0n);
    const quarter = Math.ceil(q[0].month / 3);
    const year = q[0].year;
    const closedAt = new Date(year, q[2].month, 10);
    const paidAt   = new Date(year, q[2].month, 28);

    let irpjBase = 0n;
    let irpjAdditional = 0n;
    let csllAmount = 0n;
    let accountingProfit = 0n;
    let taxableProfit = 0n;
    let totalRevenue = totalGgr;
    let deductibleExpenses = reais(p.monthly_expenses) * 3n; // 3 meses

    if (isReal) {
      // Lucro Real: lucro contábil ≈ GGR - despesas dedutíveis - tributos sobre receita
      // Tributos sobre receita já apurados ≈ Lei 14790 (12%) + PIS/COFINS NAO_CUMULATIVO (9.25% líquido)
      const tributosReceita = (totalGgr * 1265n) / 10000n; // ~12.65% (líquido)
      accountingProfit = totalGgr - deductibleExpenses - tributosReceita;
      taxableProfit = accountingProfit; // sem ajustes Lalur no demo
      irpjBase = (taxableProfit * 15n) / 100n;
      // Adicional 10% sobre o que excede R$60.000/mês × 3 = R$180.000
      const threshold = 18_000_000n; // R$ 180.000 em centavos
      if (taxableProfit > threshold) {
        irpjAdditional = ((taxableProfit - threshold) * 10n) / 100n;
      }
      csllAmount = (taxableProfit * 9n) / 100n;
    } else {
      // Lucro Presumido: base = 32% × receita; IRPJ 15% + adicional; CSLL 9%
      const basePresumida = (totalRevenue * 32n) / 100n;
      irpjBase = (basePresumida * 15n) / 100n;
      const threshold = 18_000_000n;
      if (basePresumida > threshold) {
        irpjAdditional = ((basePresumida - threshold) * 10n) / 100n;
      }
      csllAmount = (basePresumida * 9n) / 100n;
      accountingProfit = totalRevenue - deductibleExpenses;
      taxableProfit = basePresumida;
    }
    const irpjTotal = irpjBase + irpjAdditional;

    const irpjApur = await prisma.irpjCsllApuration.create({
      data: {
        period_type: IrpjApurationPeriod.TRIMESTRAL,
        year, quarter,
        ggr_revenue: totalGgr,
        total_revenue: totalRevenue,
        deductible_expenses: deductibleExpenses,
        accounting_profit: accountingProfit,
        taxable_profit: taxableProfit,
        irpj_base_amount: irpjBase,
        irpj_additional_amount: irpjAdditional,
        irpj_total: irpjTotal,
        csll_amount: csllAmount,
        total_taxes: irpjTotal + csllAmount,
        status: IrpjApurationStatus.PAID,
        closed_at: closedAt, paid_at: paidAt,
        company_id: company.id,
      },
    });
    darfsToCreate.push({
      description: `DARF IRPJ ${quarter}T/${year}`,
      amount: irpjTotal, apurationField: 'irpj_apuration_id', apurationId: irpjApur.id,
    });
    darfsToCreate.push({
      description: `DARF CSLL ${quarter}T/${year}`,
      amount: csllAmount, apurationField: 'irpj_apuration_id', apurationId: irpjApur.id,
    });
  }

  // ----- Cria os payables PAGOS para cada DARF -----
  const payableData = darfsToCreate.map(d => {
    const issue = new Date();
    issue.setDate(issue.getDate() - 30 - Math.floor(rand() * 30));
    const due = new Date(issue);
    due.setDate(issue.getDate() + 10);
    const payDate = new Date(due);
    payDate.setDate(due.getDate() - 1);
    return {
      description: d.description,
      supplier_name: 'Receita Federal do Brasil',
      amount: d.amount,
      paid_amount: d.amount,
      issue_date: issue,
      due_date: due,
      payment_date: payDate,
      status: PaymentStatus.PAID,
      source: PayableSource.TAX_APURATION,
      is_deductible_expense: false,
      generates_pis_cofins_credit: false,
      company_id: company.id,
      brand_id: brandId,
      [d.apurationField]: d.apurationId,
    };
  });
  await prisma.accountPayable.createMany({ data: payableData });
  console.log(`   ✓ ${byMonth.size} apurações mensais + 1 IRPJ trimestral, ${darfsToCreate.length} DARFs pagos`);
}

// ============================================================================
// NFSe emitidas (top GGR days)
// ============================================================================

async function seedFiscalDocuments(
  company: { id: string; cnpj: string; name: string; state: string },
  brandId: string,
  ggrRows: any[],
) {
  // Provider mockado (sandbox)
  const provider = await prisma.fiscalProvider.create({
    data: {
      type: FiscalProviderType.PLUGNOTAS,
      api_key: 'demo-fake-key',
      sandbox_mode: true,
      is_active: true,
      issue_codigo_servico: '17.06',
      issue_cnae: '9200-3/01',
      issue_inscricao_municipal: '12345678',
      issue_iss_aliquota: 5,
      issue_descricao_template: 'Receita de operação de apostas — {data}',
      company_id: company.id,
    },
  });

  // Pega 5 maiores dias por GGR — emite NFSe e cria AccountReceivable vinculado
  // (cada NFSe gera uma receita a receber; algumas pagas, algumas pendentes)
  const topDays = [...ggrRows].sort((a, b) => Number(b.ggr) - Number(a.ggr)).slice(0, 5);

  // Procura natureza de receita operacional (GGR) para vincular ao receivable
  const ggrNature = await prisma.financialNature.findFirst({
    where: { company_id: company.id, name: 'GGR (Receita de Apostas)', metadeleted: false },
  });

  const nfseIds: { id: string; r: any; index: number; total: bigint; iss: bigint; receivableId?: string }[] = [];
  for (let i = 0; i < topDays.length; i++) {
    const r = topDays[i];
    const issueDate = new Date(r.date);
    const auth = new Date(issueDate); auth.setHours(10);
    const issAmount = (BigInt(r.ggr) * 5n) / 100n;
    const number = `${1000 + i}`;

    const doc = await prisma.fiscalDocument.create({
      data: {
        document_type: FiscalDocumentType.NFSE,
        direction: FiscalDocumentDirection.OUTGOING,
        status: FiscalDocumentStatus.AUTHORIZED,
        document_number: number,
        series: '1',
        rps_number: number,
        issue_date: issueDate,
        authorization_date: auth,
        issuer_cnpj: company.cnpj.replace(/\D/g, ''),
        issuer_name: company.name,
        issuer_state: company.state,
        total_amount: BigInt(r.ggr),
        service_amount: BigInt(r.ggr),
        iss_amount: issAmount,
        iss_rate: 5,
        description: `Receita de operação de apostas — ${r.date.toISOString().slice(0, 10)}`,
        service_code: '17.06',
        cnae: '9200-3/01',
        company_id: company.id,
        provider_id: provider.id,
      },
    });
    nfseIds.push({ id: doc.id, r, index: i, total: BigInt(r.ggr), iss: issAmount });
  }

  // Cria 1 AccountReceivable por NFSe — alguns recebidos (PAID), alguns pendentes
  const receivablesCreated: any[] = [];
  for (const nfse of nfseIds) {
    const dueDate = new Date(nfse.r.date);
    dueDate.setDate(dueDate.getDate() + 30);
    const isOldEnough = dueDate < TODAY;
    const willBePaid = isOldEnough && nfse.index % 2 === 0; // alterna pago/pendente
    const receiptDate = willBePaid ? new Date(dueDate.getTime() - 86400000 * 3) : null;

    const rec = await prisma.accountReceivable.create({
      data: {
        description: `NFSe ${1000 + nfse.index} · ${nfse.r.date.toISOString().slice(0, 10)} · receita de apostas`,
        document_number: `${1000 + nfse.index}`,
        amount: nfse.total,
        received_amount: willBePaid ? nfse.total : 0n,
        issue_date: nfse.r.date,
        due_date: dueDate,
        receipt_date: receiptDate,
        status: willBePaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
        company_id: company.id,
        brand_id: brandId,
        nature_id: ggrNature?.id,
        notes: `Recebível gerado automaticamente a partir da NFSe ${1000 + nfse.index}`,
      },
    });
    // Vincula a NFSe ao receivable
    await prisma.fiscalDocument.update({
      where: { id: nfse.id },
      data: {
        matched_receivable_id: rec.id,
        matched_at: new Date(),
        match_score: 100,
      },
    });
    receivablesCreated.push(rec);
  }

  // Adiciona mais 8 receivables avulsos (sem NFSe vinculada) — variando status
  // Útil para demonstrar fluxo de caixa projetado
  const receivableExtras = [
    { desc: 'Patrocínio mensal — Time A', amount: 250_000, dueOffset: 5 },
    { desc: 'Royalties licenciamento de marca', amount: 80_000, dueOffset: 12 },
    { desc: 'Reembolso de campanha conjunta', amount: 35_000, dueOffset: -10 }, // pendente vencido
    { desc: 'Receita de dados (parceria mídia)', amount: 60_000, dueOffset: 25 },
    { desc: 'Cashback retornado de PSP', amount: 18_500, dueOffset: -20 }, // recebido
    { desc: 'Acordo comercial trimestral', amount: 120_000, dueOffset: 18 },
    { desc: 'Indenização processo encerrado', amount: 45_000, dueOffset: -45 }, // recebido
    { desc: 'Receita de juros de aplicação', amount: 12_300, dueOffset: -3 },   // recebido
  ];
  for (let i = 0; i < receivableExtras.length; i++) {
    const ext = receivableExtras[i];
    const issueDate = new Date(TODAY); issueDate.setDate(issueDate.getDate() + ext.dueOffset - 30);
    const dueDate = new Date(TODAY); dueDate.setDate(dueDate.getDate() + ext.dueOffset);
    const isPaid = ext.dueOffset < 0 && i % 3 !== 0; // 2/3 dos vencidos foram recebidos
    const receiptDate = isPaid ? new Date(dueDate.getTime() - 86400000) : null;
    await prisma.accountReceivable.create({
      data: {
        description: ext.desc,
        amount: reais(ext.amount),
        received_amount: isPaid ? reais(ext.amount) : 0n,
        issue_date: issueDate,
        due_date: dueDate,
        receipt_date: receiptDate,
        status: isPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
        company_id: company.id,
        brand_id: brandId,
      },
    });
  }

  console.log(`   ✓ FiscalProvider (sandbox) + ${nfseIds.length} NFSe emitidas + ${receivablesCreated.length} recebíveis vinculados + ${receivableExtras.length} recebíveis avulsos`);
}

// ============================================================================
// Snapshots de auditoria — popula a tela /audit/history
// ============================================================================

async function seedAuditSnapshots(
  companyId: string,
  brandId: string,
  playerWalletId: string,
  ggrRows: any[],
  p: CompanyProfile,
) {
  // Cria 3 snapshots históricos (uma por mês) para cada tipo de auditoria

  const months = new Map<string, any[]>();
  for (const r of ggrRows) {
    const k = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`;
    if (!months.has(k)) months.set(k, []);
    months.get(k)!.push(r);
  }
  const monthList = [...months.entries()].sort();

  for (const [, rows] of monthList) {
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    const fromDate = rows[0].date;
    const toDate   = rows[rows.length - 1].date;

    // ----- Movements check -----
    const sistemaDep: bigint = rows.reduce<bigint>((s, r) => s + BigInt(r.total_deposits), 0n);
    const sistemaSaq: bigint = rows.reduce<bigint>((s, r) => s + BigInt(r.total_withdrawals), 0n);
    // Banco com drift de 0.3% (dentro do OK)
    const drift = 1.003;
    const bancoDep = BigInt(Math.round(Number(sistemaDep) * drift));
    const bancoSaq = BigInt(Math.round(Number(sistemaSaq) * drift));
    const sistemaNet = sistemaDep - sistemaSaq;
    const bancoNet   = bancoDep - bancoSaq;
    const diffNet    = bancoNet - sistemaNet;

    await prisma.auditMovementsCheck.create({
      data: {
        from_date: fromDate, to_date: toDate,
        sistema_deposits: sistemaDep, sistema_withdrawals: sistemaSaq, sistema_net: sistemaNet,
        banco_deposits:   bancoDep,   banco_withdrawals:   bancoSaq,   banco_net:   bancoNet,
        diff_deposits:    bancoDep - sistemaDep,
        diff_withdrawals: bancoSaq - sistemaSaq,
        diff_net:         diffNet,
        alert_level: AuditAlertLevel.OK,
        company_id: companyId,
      },
    });

    // ----- Fees check -----
    const totalDepCount = rows.reduce((s, r) => s + r.deposit_count, 0);
    const totalWdCount  = rows.reduce((s, r) => s + r.withdrawal_count, 0);
    const expectedCredit = BigInt(totalDepCount) * 50n;   // R$ 0,50
    const expectedDebit  = BigInt(totalWdCount)  * 250n;  // R$ 2,50
    const expectedTotal  = expectedCredit + expectedDebit;
    const actualTotal    = BigInt(Math.round(Number(expectedTotal) * 1.005)); // +0.5% (OK)
    const diffFees       = actualTotal - expectedTotal;

    await prisma.auditFeesCheck.create({
      data: {
        from_date: fromDate, to_date: toDate,
        total_deposits_count: totalDepCount,
        total_withdrawals_count: totalWdCount,
        expected_credit_fees: expectedCredit,
        expected_debit_fees:  expectedDebit,
        expected_total_fees:  expectedTotal,
        actual_total_fees:    actualTotal,
        diff_total_fees:      diffFees,
        alert_level: AuditAlertLevel.OK,
        company_id: companyId,
      },
    });
  }

  // ----- Taxes check (1 snapshot cobrindo o período inteiro) -----
  const allDates = ggrRows.map(r => r.date).sort((a, b) => a.getTime() - b.getTime());
  const totalGgr: bigint = ggrRows.reduce<bigint>((s, r) => s + BigInt(r.ggr), 0n);
  const lei14790 = (totalGgr * 12n) / 100n;
  const pisRate = p.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO ? 1.65 : 0.65;
  const cofinsRate = p.pis_cofins_regime === PisCofinsRegime.NAO_CUMULATIVO ? 7.6 : 3.0;
  const pis    = BigInt(Math.round(Number(totalGgr) * pisRate / 100));
  const cofins = BigInt(Math.round(Number(totalGgr) * cofinsRate / 100));
  const iss    = (totalGgr * 5n) / 100n;
  const calculatedTotal = lei14790 + pis + cofins + iss;
  const paidTotal       = calculatedTotal; // tudo pago — OK
  const breakdown = [
    { type: 'Lei 14.790', calculated: lei14790.toString(), paid: lei14790.toString(), diff: '0', items: [] },
    { type: 'PIS',        calculated: pis.toString(),      paid: pis.toString(),      diff: '0', items: [] },
    { type: 'COFINS',     calculated: cofins.toString(),   paid: cofins.toString(),   diff: '0', items: [] },
    { type: 'ISS',        calculated: iss.toString(),      paid: iss.toString(),      diff: '0', items: [] },
  ];

  await prisma.auditTaxesCheck.create({
    data: {
      from_date: allDates[0], to_date: allDates[allDates.length - 1],
      calculated_total: calculatedTotal, paid_total: paidTotal, diff_total: 0n,
      per_tax_breakdown: breakdown as any,
      alert_level: AuditAlertLevel.OK,
      company_id: companyId,
    },
  });

  console.log(`   ✓ ${monthList.length} snapshots de movements + ${monthList.length} de fees + 1 de taxes (todos OK)`);
}

// ============= Main =============

async function main() {
  console.log('🌱 Demo seed iniciando…');
  for (const p of PROFILES) {
    await seedCompany(p);
  }
  console.log('\n✨ Demo seed concluído.\n');
  console.log('Logins:');
  console.log('  admin            / 123456   (ADMIN — vê todas as empresas)');
  for (const p of PROFILES) {
    console.log(`  ${p.manager_username.padEnd(16)} / 123456   (MANAGER — ${p.name})`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
