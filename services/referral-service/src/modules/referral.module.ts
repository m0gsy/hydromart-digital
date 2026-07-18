import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { ReferralConfigService } from '../config/referral-config.service';
import { REFERRAL_TOKENS } from '../application/tokens';
import { ReferralService } from '../application/services/referral.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ReferralPrismaRepository } from '../infrastructure/prisma/referral.prisma.repository';
import { LoyaltyRewardHttpAdapter } from '../infrastructure/http/loyalty-reward.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { ReferralController } from './referral.controller';

const providers: Provider[] = [
  PrismaService,
  ReferralConfigService,
  ReferralService,
  { provide: REFERRAL_TOKENS.ReferralRepository, useClass: ReferralPrismaRepository },
  { provide: REFERRAL_TOKENS.LoyaltyReward, useClass: LoyaltyRewardHttpAdapter },
  { provide: REFERRAL_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [ReferralController],
  providers,
  exports: [PrismaService, ReferralConfigService],
})
export class ReferralModule {}
