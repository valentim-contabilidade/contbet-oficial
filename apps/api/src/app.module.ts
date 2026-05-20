import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { BrandsModule } from './brands/brands.module';
import { AuditModule } from './audit/audit.module';
import { ChartOfAccountsModule } from './financial/chart-of-accounts/chart-of-accounts.module';
import { FinancialCategoriesModule } from './financial/financial-categories/financial-categories.module';
import { FinancialNaturesModule } from './financial/financial-natures/financial-natures.module';
import { BankAccountsModule } from './financial/bank-accounts/bank-accounts.module';
import { AccountsPayableModule } from './financial/accounts-payable/accounts-payable.module';
import { AccountsReceivableModule } from './financial/accounts-receivable/accounts-receivable.module';
import { TransactionsModule } from './financial/transactions/transactions.module';
import { ContactsModule } from './contacts/contacts.module';
import { BanksModule } from './banks/banks.module';
import { BankStatementsModule } from './financial/bank-statements/bank-statements.module';
import { GgrModule } from './ggr/ggr.module';
import { TaxModule } from './tax/tax.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { ReportsModule } from './reports/reports.module';
import { AccountingModule } from './accounting/accounting.module';
import { BankIntegrationsModule } from './bank-integrations/bank-integrations.module';
import { AuditChecksModule } from './audit-checks/audit-checks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { SerproModule } from './serpro/serpro.module';
import { WebhooksModule } from './webhooks/focus-nfe.webhook';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    BrandsModule,
    AuditModule,
    ChartOfAccountsModule,
    FinancialCategoriesModule,
    FinancialNaturesModule,
    BankAccountsModule,
    AccountsPayableModule,
    AccountsReceivableModule,
    TransactionsModule,
    ContactsModule,
    BanksModule,
    BankStatementsModule,
    GgrModule,
    TaxModule,
    FiscalModule,
    ReportsModule,
    AccountingModule,
    BankIntegrationsModule,
    AuditChecksModule,
    DashboardModule,
    DataSourcesModule,
    SerproModule,
    WebhooksModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
