import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { DepotScopeGuard, JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { RecommendationConfigService } from '../config/recommendation-config.service';
import { RECOMMENDATION_TOKENS } from '../application/tokens';
import { RecommendationService } from '../application/services/recommendation.service';
import { RebuildService } from '../application/services/rebuild.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { RecommendationPrismaRepository } from '../infrastructure/prisma/recommendation.prisma.repository';
import { OrderFeedHttpAdapter } from '../infrastructure/http/order-feed.http.adapter';
import { IngestController } from './ingest.controller';
import { RecommendationController } from './recommendation.controller';

const providers: Provider[] = [
  PrismaService,
  RecommendationConfigService,
  RecommendationService,
  RebuildService,
  { provide: RECOMMENDATION_TOKENS.Repository, useClass: RecommendationPrismaRepository },
  { provide: RECOMMENDATION_TOKENS.OrderFeed, useClass: OrderFeedHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  // Registered even though neither controller takes a `depotId` today: the next
  // depot-scoped route added here would otherwise be born unguarded, and nothing in the
  // service would say so. `scripts/check-depot-scope-guards.mjs` keeps every service
  // holding this line.
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [IngestController, RecommendationController],
  providers,
  exports: [PrismaService, RecommendationConfigService],
})
export class RecommendationModule {}
