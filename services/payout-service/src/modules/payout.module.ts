import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { PayoutConfigService } from '../config/payout-config.service';
import { PAYOUT_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { PayoutService } from '../application/services/payout.service';
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
import { HqPayoutController } from './hq-payout.controller';
import { CommissionController } from './commission.controller';
import { CourierPayoutController } from './courier-payout.controller';
import { ExpenseApprovalController } from './expense-approval.controller';
import { EarningRuleController } from './earning-rule.controller';
import { SettingsController } from './settings.controller';

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
  CommissionService,
  CourierPayoutService,
  ExpenseClaimService,
  SettingsService,
  { provide: PAYOUT_TOKENS.LedgerRepository, useClass: LedgerPrismaRepository },
  { provide: PAYOUT_TOKENS.WithdrawalRepository, useClass: WithdrawalPrismaRepository },
  { provide: PAYOUT_TOKENS.CommissionSchemeRepository, useClass: CommissionSchemePrismaRepository },
  { provide: PAYOUT_TOKENS.CourierLedgerRepository, useClass: CourierLedgerPrismaRepository },
  { provide: PAYOUT_TOKENS.CourierWithdrawalRepository, useClass: CourierWithdrawalPrismaRepository },
  { provide: PAYOUT_TOKENS.ExpenseClaimRepository, useClass: ExpenseClaimPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    PayoutController,
    HqPayoutController,
    CommissionController,
    CourierPayoutController,
    ExpenseApprovalController,
    EarningRuleController,
    SettingsController,
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
