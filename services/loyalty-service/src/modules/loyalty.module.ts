import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { LoyaltyConfigService } from '../config/loyalty-config.service';
import { LOYALTY_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { LoyaltyService } from '../application/services/loyalty.service';
import { RewardService } from '../application/services/reward.service';
import { SettingsService } from '../application/services/settings.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { LoyaltyPrismaRepository } from '../infrastructure/prisma/loyalty.prisma.repository';
import { RewardPrismaRepository } from '../infrastructure/prisma/reward.prisma.repository';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { LoyaltyController } from './loyalty.controller';
import { RewardController } from './reward.controller';
import { SettingsController } from './settings.controller';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  LoyaltyConfigService,
  LoyaltyService,
  RewardService,
  SettingsService,
  { provide: LOYALTY_TOKENS.LoyaltyRepository, useClass: LoyaltyPrismaRepository },
  { provide: LOYALTY_TOKENS.RewardRepository, useClass: RewardPrismaRepository },
  { provide: LOYALTY_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [LoyaltyController, RewardController, SettingsController],
  providers,
  exports: [PrismaService, LoyaltyConfigService],
})
export class LoyaltyModule implements OnApplicationBootstrap {
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
