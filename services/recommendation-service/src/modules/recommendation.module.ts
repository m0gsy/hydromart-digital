import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

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
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [IngestController, RecommendationController],
  providers,
  exports: [PrismaService, RecommendationConfigService],
})
export class RecommendationModule {}
