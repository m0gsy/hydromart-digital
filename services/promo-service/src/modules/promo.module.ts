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
import { PromotionService } from '../application/services/promotion.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { VoucherPrismaRepository } from '../infrastructure/prisma/voucher.prisma.repository';
import { PromotionPrismaRepository } from '../infrastructure/prisma/promotion.prisma.repository';
import { CustomerLookupHttpAdapter } from '../infrastructure/http/customer-lookup.http.adapter';
import { NotificationHttpAdapter } from '../infrastructure/http/notification.http.adapter';
import { OrderValueHttpAdapter } from '../infrastructure/http/order-value.http.adapter';
import { VoucherController } from './voucher.controller';
import { PromotionController } from './promotion.controller';

// Exported so the guard registration is assertable without booting the module — see
// test/unit/depot-scope-registration.spec.ts (B-14).
export const providers: Provider[] = [
  PrismaService,
  PromoConfigService,
  VoucherService,
  PromotionService,
  { provide: PROMO_TOKENS.VoucherRepository, useClass: VoucherPrismaRepository },
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
  /*
   * B-14 installed this because `depots/:depotId/voucher-requests` handed a path parameter
   * straight to a service with nothing checking it against the caller's scope.
   *
   * CA-2-42 removed that route, but the guard stays: it is a module-wide APP_GUARD, and
   * promo-service will grow another depot-scoped path. Taking it out now would mean the
   * next one arrives unguarded and nobody notices — which is exactly how B-14 happened.
   */
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [VoucherController, PromotionController],
  providers,
  exports: [PrismaService, PromoConfigService],
})
export class PromoModule {}
