import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import {
  JwtAuthGuard,
  SettingsCache,
  RolesGuard,
  DepotScopeGuard,
  httpAccountNameResolver,
} from '@hydromart/platform';

import { ForecastConfigService } from '../config/forecast-config.service';
import { FORECAST_TOKENS } from '../application/tokens';
import { ForecastService } from '../application/services/forecast.service';
import { RebuildService } from '../application/services/rebuild.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ForecastPrismaRepository } from '../infrastructure/prisma/forecast.prisma.repository';
import { OrderFeedHttpAdapter } from '../infrastructure/http/order-feed.http.adapter';
import { DepotOwnershipHttpAdapter } from '../infrastructure/http/depot-ownership.http.adapter';
import { IngestController } from './ingest.controller';
import { ForecastController } from './forecast.controller';

import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { SettingsService } from '../application/services/settings.service';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { SettingsController } from './settings.controller';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  SettingsService,
  ForecastConfigService,
  ForecastService,
  RebuildService,
  { provide: FORECAST_TOKENS.Repository, useClass: ForecastPrismaRepository },
  { provide: FORECAST_TOKENS.OrderFeed, useClass: OrderFeedHttpAdapter },
  { provide: FORECAST_TOKENS.DepotOwnership, useClass: DepotOwnershipHttpAdapter },
  {
    provide: FORECAST_TOKENS.AccountNames,
    inject: [ForecastConfigService],
    useFactory: (config: ForecastConfigService) =>
      httpAccountNameResolver({
        authServiceUrl: config.authServiceUrl,
        internalKey: config.internalServiceKey,
      }),
  },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [IngestController, ForecastController, SettingsController],
  providers,
  exports: [PrismaService, ForecastConfigService],
})
export class ForecastModule {}
