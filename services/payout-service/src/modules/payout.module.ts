import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import {
  AUDIT_MUTATION_SINK,
  JwtAuthGuard,
  RolesGuard,
  DepotScopeGuard,
  SettingsCache,
} from '@hydromart/platform';

import { PayoutConfigService } from '../config/payout-config.service';
import { PhotoLinkHttpAdapter } from '../infrastructure/http/photo-link.http.adapter';
import { ExpenseClaimAlertHttpAdapter } from '../infrastructure/http/expense-claim-alert.http.adapter';
import { PAYOUT_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { PayoutService } from '../application/services/payout.service';
import { HqReleaseService } from '../application/services/hq-release.service';
import { HqPayoutExportService } from '../application/services/hq-payout-export.service';
import { PayoutBankAccountService } from '../application/services/bank-account.service';
import { PayoutBankAccountPrismaRepository } from '../infrastructure/prisma/bank-account.prisma.repository';
import { ReleaseRequestPrismaRepository } from '../infrastructure/prisma/release-request.prisma.repository';
import { CommissionService } from '../application/services/commission.service';
import { CourierPayoutService } from '../application/services/courier-payout.service';
import { ExpenseClaimService } from '../application/services/expense-claim.service';
import { SettingsService } from '../application/services/settings.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { LedgerPrismaRepository } from '../infrastructure/prisma/ledger.prisma.repository';
import { WithdrawalPrismaRepository } from '../infrastructure/prisma/withdrawal.prisma.repository';
import { CommissionSchemePrismaRepository } from '../infrastructure/prisma/commission-scheme.prisma.repository';
import { CourierLedgerPrismaRepository } from '../infrastructure/prisma/courier-ledger.prisma.repository';
import { CourierWithdrawalPrismaRepository } from '../infrastructure/prisma/courier-withdrawal.prisma.repository';
import { ExpenseClaimPrismaRepository } from '../infrastructure/prisma/expense-claim.prisma.repository';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { PayoutController } from './payout.controller';
import { PayoutBankAccountController } from './bank-account.controller';
import { HqPayoutController } from './hq-payout.controller';
import { CommissionController } from './commission.controller';
import { CourierPayoutController } from './courier-payout.controller';
import { ExpenseApprovalController } from './expense-approval.controller';
import { EarningRuleController } from './earning-rule.controller';
import { SettingsController } from './settings.controller';
import { PendingApprovalsController } from './pending-approvals.controller';
import { PartnerBillController, PartnerBillExternalController } from './partner-bill.controller';
import { PartnerBillService } from '../application/services/partner-bill.service';
import { PartnerBillPrismaRepository } from '../infrastructure/prisma/partner-bill.prisma.repository';
import { PartnerBillSourcesHttpAdapter } from '../infrastructure/http/partner-bill-sources.http.adapter';
import { PartnerBillNotifierHttpAdapter } from '../infrastructure/http/partner-bill-notifier.http.adapter';
import { PayoutAuditSink } from '../infrastructure/http/audit.sink';
import { PendingApprovalsPrismaReader } from '../infrastructure/prisma/pending-approvals.prisma.reader';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  PayoutConfigService,
  PayoutService,
  HqReleaseService,
  HqPayoutExportService,
  PayoutBankAccountService,
  { provide: PAYOUT_TOKENS.ReleaseRequestRepository, useClass: ReleaseRequestPrismaRepository },
  { provide: PAYOUT_TOKENS.BankAccountRepository, useClass: PayoutBankAccountPrismaRepository },
  CommissionService,
  CourierPayoutService,
  ExpenseClaimService,
  SettingsService,
  { provide: PAYOUT_TOKENS.LedgerRepository, useClass: LedgerPrismaRepository },
  { provide: PAYOUT_TOKENS.WithdrawalRepository, useClass: WithdrawalPrismaRepository },
  { provide: PAYOUT_TOKENS.CommissionSchemeRepository, useClass: CommissionSchemePrismaRepository },
  { provide: PAYOUT_TOKENS.CourierLedgerRepository, useClass: CourierLedgerPrismaRepository },
  {
    provide: PAYOUT_TOKENS.CourierWithdrawalRepository,
    useClass: CourierWithdrawalPrismaRepository,
  },
  { provide: PAYOUT_TOKENS.ExpenseClaimRepository, useClass: ExpenseClaimPrismaRepository },
  // CA-4-49: delivery-service owns the bucket a receipt lives in; this asks it for a link.
  { provide: PAYOUT_TOKENS.PhotoLink, useClass: PhotoLinkHttpAdapter },
  { provide: PAYOUT_TOKENS.ExpenseClaimAlert, useClass: ExpenseClaimAlertHttpAdapter },
  { provide: PAYOUT_TOKENS.PendingApprovalsReader, useClass: PendingApprovalsPrismaReader },
  // HD-23: the monthly partner bill.
  PartnerBillService,
  { provide: PAYOUT_TOKENS.PartnerBillRepository, useClass: PartnerBillPrismaRepository },
  { provide: PAYOUT_TOKENS.PartnerBillSources, useClass: PartnerBillSourcesHttpAdapter },
  { provide: PAYOUT_TOKENS.PartnerBillNotifier, useClass: PartnerBillNotifierHttpAdapter },
  { provide: AUDIT_MUTATION_SINK, useClass: PayoutAuditSink },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    PayoutBankAccountController,
    PayoutController,
    HqPayoutController,
    CommissionController,
    CourierPayoutController,
    ExpenseApprovalController,
    EarningRuleController,
    SettingsController,
    PendingApprovalsController,
    PartnerBillController,
    PartnerBillExternalController,
  ],
  providers,
  exports: [PrismaService, PayoutConfigService],
})
export class PayoutModule implements OnApplicationBootstrap {
  constructor(private readonly settingsCache: SettingsCache) {}

  async onApplicationBootstrap(): Promise<void> {
    // ponytail: fail-open — a boot-time DB hiccup must not crash the service; an
    // empty snapshot just means every getter falls through to its env default
    // (SettingsCache's own documented behavior), and the interval retries anyway.
    await this.settingsCache.refresh().catch(() => {});
    setInterval(() => {
      this.settingsCache.refresh().catch(() => {});
    }, this.settingsCache.ttl).unref();
  }
}
