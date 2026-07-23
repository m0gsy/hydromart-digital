import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { ReferralConfigService } from '../config/referral-config.service';
import { REFERRAL_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { ReferralService } from '../application/services/referral.service';
import { SettingsService } from '../application/services/settings.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ReferralPrismaRepository } from '../infrastructure/prisma/referral.prisma.repository';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { LoyaltyRewardHttpAdapter } from '../infrastructure/http/loyalty-reward.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { ReferralController } from './referral.controller';
import { SettingsController } from './settings.controller';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  ReferralConfigService,
  ReferralService,
  SettingsService,
  { provide: REFERRAL_TOKENS.ReferralRepository, useClass: ReferralPrismaRepository },
  { provide: REFERRAL_TOKENS.LoyaltyReward, useClass: LoyaltyRewardHttpAdapter },
  { provide: REFERRAL_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [ReferralController, SettingsController],
  providers,
  exports: [PrismaService, ReferralConfigService],
})
export class ReferralModule implements OnApplicationBootstrap {
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
