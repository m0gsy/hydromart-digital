import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { LoyaltyConfigService } from '../config/loyalty-config.service';
import { LOYALTY_TOKENS } from '../application/tokens';
import { LoyaltyService } from '../application/services/loyalty.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { LoyaltyPrismaRepository } from '../infrastructure/prisma/loyalty.prisma.repository';
import { LoyaltyController } from './loyalty.controller';

const providers: Provider[] = [
  PrismaService,
  LoyaltyConfigService,
  LoyaltyService,
  { provide: LOYALTY_TOKENS.LoyaltyRepository, useClass: LoyaltyPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [LoyaltyController],
  providers,
  exports: [PrismaService, LoyaltyConfigService],
})
export class LoyaltyModule {}
