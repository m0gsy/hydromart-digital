import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { ForecastConfigService } from '../config/forecast-config.service';
import { FORECAST_TOKENS } from '../application/tokens';
import { ForecastService } from '../application/services/forecast.service';
import { RebuildService } from '../application/services/rebuild.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ForecastPrismaRepository } from '../infrastructure/prisma/forecast.prisma.repository';
import { OrderFeedHttpAdapter } from '../infrastructure/http/order-feed.http.adapter';
import { IngestController } from './ingest.controller';
import { ForecastController } from './forecast.controller';

const providers: Provider[] = [
  PrismaService,
  ForecastConfigService,
  ForecastService,
  RebuildService,
  { provide: FORECAST_TOKENS.Repository, useClass: ForecastPrismaRepository },
  { provide: FORECAST_TOKENS.OrderFeed, useClass: OrderFeedHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [IngestController, ForecastController],
  providers,
  exports: [PrismaService, ForecastConfigService],
})
export class ForecastModule {}
