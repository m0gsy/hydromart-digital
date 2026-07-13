import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { PayoutConfigService } from '../config/payout-config.service';
import { PAYOUT_TOKENS } from '../application/tokens';
import { PayoutService } from '../application/services/payout.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { LedgerPrismaRepository } from '../infrastructure/prisma/ledger.prisma.repository';
import { WithdrawalPrismaRepository } from '../infrastructure/prisma/withdrawal.prisma.repository';
import { PayoutController } from './payout.controller';

const providers: Provider[] = [
  PrismaService,
  PayoutConfigService,
  PayoutService,
  { provide: PAYOUT_TOKENS.LedgerRepository, useClass: LedgerPrismaRepository },
  { provide: PAYOUT_TOKENS.WithdrawalRepository, useClass: WithdrawalPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [PayoutController],
  providers,
  exports: [PrismaService, PayoutConfigService],
})
export class PayoutModule {}
