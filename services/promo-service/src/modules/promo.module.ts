import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import {
  DepotScopeGuard,
  JwtAuthGuard,
  RolesGuard,
  httpAccountNameResolver,
} from '@hydromart/platform';

import { PromoConfigService } from '../config/promo-config.service';
import { PROMO_TOKENS } from '../application/tokens';
import { VoucherService } from '../application/services/voucher.service';
import { VoucherRequestService } from '../application/services/voucher-request.service';
import { PromotionService } from '../application/services/promotion.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { VoucherPrismaRepository } from '../infrastructure/prisma/voucher.prisma.repository';
import { VoucherRequestPrismaRepository } from '../infrastructure/prisma/voucher-request.prisma.repository';
import { PromotionPrismaRepository } from '../infrastructure/prisma/promotion.prisma.repository';
import { CustomerLookupHttpAdapter } from '../infrastructure/http/customer-lookup.http.adapter';
import { NotificationHttpAdapter } from '../infrastructure/http/notification.http.adapter';
import { OrderValueHttpAdapter } from '../infrastructure/http/order-value.http.adapter';
import { VoucherController } from './voucher.controller';
import {
  DepotVoucherRequestController,
  VoucherRequestController,
} from './voucher-request.controller';
import { PromotionController } from './promotion.controller';

// Exported so the guard registration is assertable without booting the module — see
// test/unit/depot-scope-registration.spec.ts (B-14).
export const providers: Provider[] = [
  PrismaService,
  PromoConfigService,
  VoucherService,
  VoucherRequestService,
  PromotionService,
  { provide: PROMO_TOKENS.VoucherRepository, useClass: VoucherPrismaRepository },
  { provide: PROMO_TOKENS.VoucherRequestRepository, useClass: VoucherRequestPrismaRepository },
  { provide: PROMO_TOKENS.PromotionRepository, useClass: PromotionPrismaRepository },
  { provide: PROMO_TOKENS.CustomerLookup, useClass: CustomerLookupHttpAdapter },
  { provide: PROMO_TOKENS.Notification, useClass: NotificationHttpAdapter },
  { provide: PROMO_TOKENS.OrderValues, useClass: OrderValueHttpAdapter },
  {
    provide: PROMO_TOKENS.AccountNames,
    inject: [PromoConfigService],
    useFactory: (config: PromoConfigService) =>
      httpAccountNameResolver({
        authServiceUrl: config.authServiceUrl,
        internalKey: config.internalServiceKey,
      }),
  },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  // B-14: promo-service exposes `depots/:depotId/voucher-requests` and hands the path
  // parameter straight to the service. Without this guard that depotId was never checked
  // against the caller's scope — depot scoping enforced by a guard nobody installed.
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    VoucherController,
    DepotVoucherRequestController,
    VoucherRequestController,
    PromotionController,
  ],
  providers,
  exports: [PrismaService, PromoConfigService],
})
export class PromoModule {}
