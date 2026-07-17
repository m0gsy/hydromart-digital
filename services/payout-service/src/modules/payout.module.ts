import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { PayoutConfigService } from '../config/payout-config.service';
import { PAYOUT_TOKENS } from '../application/tokens';
import { PayoutService } from '../application/services/payout.service';
import { CommissionService } from '../application/services/commission.service';
import { CourierPayoutService } from '../application/services/courier-payout.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { LedgerPrismaRepository } from '../infrastructure/prisma/ledger.prisma.repository';
import { WithdrawalPrismaRepository } from '../infrastructure/prisma/withdrawal.prisma.repository';
import { CommissionSchemePrismaRepository } from '../infrastructure/prisma/commission-scheme.prisma.repository';
import { CourierLedgerPrismaRepository } from '../infrastructure/prisma/courier-ledger.prisma.repository';
import { CourierWithdrawalPrismaRepository } from '../infrastructure/prisma/courier-withdrawal.prisma.repository';
import { PayoutController } from './payout.controller';
import { HqPayoutController } from './hq-payout.controller';
import { CommissionController } from './commission.controller';
import { CourierPayoutController } from './courier-payout.controller';

const providers: Provider[] = [
  PrismaService,
  PayoutConfigService,
  PayoutService,
  CommissionService,
  CourierPayoutService,
  { provide: PAYOUT_TOKENS.LedgerRepository, useClass: LedgerPrismaRepository },
  { provide: PAYOUT_TOKENS.WithdrawalRepository, useClass: WithdrawalPrismaRepository },
  { provide: PAYOUT_TOKENS.CommissionSchemeRepository, useClass: CommissionSchemePrismaRepository },
  { provide: PAYOUT_TOKENS.CourierLedgerRepository, useClass: CourierLedgerPrismaRepository },
  { provide: PAYOUT_TOKENS.CourierWithdrawalRepository, useClass: CourierWithdrawalPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [PayoutController, HqPayoutController, CommissionController, CourierPayoutController],
  providers,
  exports: [PrismaService, PayoutConfigService],
})
export class PayoutModule {}
