import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { PromoConfigService } from '../config/promo-config.service';
import { PROMO_TOKENS } from '../application/tokens';
import { VoucherService } from '../application/services/voucher.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { VoucherPrismaRepository } from '../infrastructure/prisma/voucher.prisma.repository';
import { VoucherController } from './voucher.controller';

const providers: Provider[] = [
  PrismaService,
  PromoConfigService,
  VoucherService,
  { provide: PROMO_TOKENS.VoucherRepository, useClass: VoucherPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [VoucherController],
  providers,
  exports: [PrismaService, PromoConfigService],
})
export class PromoModule {}
