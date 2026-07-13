import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { PromoConfigService } from '../config/promo-config.service';
import { PROMO_TOKENS } from '../application/tokens';
import { VoucherService } from '../application/services/voucher.service';
import { PromotionService } from '../application/services/promotion.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { VoucherPrismaRepository } from '../infrastructure/prisma/voucher.prisma.repository';
import { PromotionPrismaRepository } from '../infrastructure/prisma/promotion.prisma.repository';
import { CustomerLookupHttpAdapter } from '../infrastructure/http/customer-lookup.http.adapter';
import { NotificationHttpAdapter } from '../infrastructure/http/notification.http.adapter';
import { VoucherController } from './voucher.controller';
import { PromotionController } from './promotion.controller';

const providers: Provider[] = [
  PrismaService,
  PromoConfigService,
  VoucherService,
  PromotionService,
  { provide: PROMO_TOKENS.VoucherRepository, useClass: VoucherPrismaRepository },
  { provide: PROMO_TOKENS.PromotionRepository, useClass: PromotionPrismaRepository },
  { provide: PROMO_TOKENS.CustomerLookup, useClass: CustomerLookupHttpAdapter },
  { provide: PROMO_TOKENS.Notification, useClass: NotificationHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [VoucherController, PromotionController],
  providers,
  exports: [PrismaService, PromoConfigService],
})
export class PromoModule {}
