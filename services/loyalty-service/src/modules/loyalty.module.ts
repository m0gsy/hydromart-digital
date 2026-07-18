import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { LoyaltyConfigService } from '../config/loyalty-config.service';
import { LOYALTY_TOKENS } from '../application/tokens';
import { LoyaltyService } from '../application/services/loyalty.service';
import { RewardService } from '../application/services/reward.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { LoyaltyPrismaRepository } from '../infrastructure/prisma/loyalty.prisma.repository';
import { RewardPrismaRepository } from '../infrastructure/prisma/reward.prisma.repository';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { LoyaltyController } from './loyalty.controller';
import { RewardController } from './reward.controller';

const providers: Provider[] = [
  PrismaService,
  LoyaltyConfigService,
  LoyaltyService,
  RewardService,
  { provide: LOYALTY_TOKENS.LoyaltyRepository, useClass: LoyaltyPrismaRepository },
  { provide: LOYALTY_TOKENS.RewardRepository, useClass: RewardPrismaRepository },
  { provide: LOYALTY_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [LoyaltyController, RewardController],
  providers,
  exports: [PrismaService, LoyaltyConfigService],
})
export class LoyaltyModule {}
