import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { OrderConfigService } from '../config/order-config.service';
import { ORDER_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { CartService } from '../application/services/cart.service';
import { OrderService } from '../application/services/order.service';
import { OutboxService } from '../application/services/outbox.service';
import { MeterService } from '../application/services/meter.service';
import { ReportService } from '../application/services/report.service';
import { SubscriptionService } from '../application/services/subscription.service';
import { SettingsService } from '../application/services/settings.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CartPrismaRepository } from '../infrastructure/prisma/cart.prisma.repository';
import { MeterReadingPrismaRepository } from '../infrastructure/prisma/meter-reading.prisma.repository';
import { OrderPrismaRepository } from '../infrastructure/prisma/order.prisma.repository';
import { OutboxPrismaRepository } from '../infrastructure/prisma/outbox.prisma.repository';
import { SubscriptionPrismaRepository } from '../infrastructure/prisma/subscription.prisma.repository';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { ProductCatalogHttpAdapter } from '../infrastructure/http/product-catalog.http.adapter';
import { DepotDirectoryHttpAdapter } from '../infrastructure/http/depot-directory.http.adapter';
import { DepotPricingHttpAdapter } from '../infrastructure/http/depot-pricing.http.adapter';
import { LoyaltyCoordinationHttpAdapter } from '../infrastructure/http/loyalty-coordination.http.adapter';
import { ReferralCoordinationHttpAdapter } from '../infrastructure/http/referral-coordination.http.adapter';
import { RecommendationCoordinationHttpAdapter } from '../infrastructure/http/recommendation-coordination.http.adapter';
import { ForecastCoordinationHttpAdapter } from '../infrastructure/http/forecast-coordination.http.adapter';
import { FranchiseRevenueHttpAdapter } from '../infrastructure/http/franchise-revenue.http.adapter';
import { GallonIssueHttpAdapter } from '../infrastructure/http/gallon-issue.http.adapter';
import { CashierShiftHttpAdapter } from '../infrastructure/http/cashier-shift.http.adapter';
import { PaymentReversalHttpAdapter } from '../infrastructure/http/payment-reversal.http.adapter';
import { PaymentCashHttpAdapter } from '../infrastructure/http/payment-cash.http.adapter';
import { DeliverySlaHttpAdapter } from '../infrastructure/http/delivery-sla.http.adapter';
import { DepotCostsHttpAdapter } from '../infrastructure/http/depot-costs.http.adapter';
import { MembershipHttpAdapter } from '../infrastructure/http/membership.http.adapter';
import { ResellerDiscountHttpAdapter } from '../infrastructure/http/reseller-discount.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { NotificationHttpAdapter } from '../infrastructure/http/notification.http.adapter';
import { PromoHttpAdapter } from '../infrastructure/http/promo.http.adapter';
import { InventoryHttpAdapter } from '../infrastructure/http/inventory.http.adapter';
import { CartController } from './cart.controller';
import { OrderController } from './order.controller';
import { MeterController } from './meter.controller';
import { ReportController } from './report.controller';
import { SubscriptionController } from './subscription.controller';
import { SettingsController } from './settings.controller';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  OrderConfigService,
  CartService,
  OrderService,
  OutboxService,
  MeterService,
  ReportService,
  SubscriptionService,
  SettingsService,
  { provide: ORDER_TOKENS.CartRepository, useClass: CartPrismaRepository },
  { provide: ORDER_TOKENS.OrderRepository, useClass: OrderPrismaRepository },
  { provide: ORDER_TOKENS.OutboxRepository, useClass: OutboxPrismaRepository },
  { provide: ORDER_TOKENS.MeterReadingRepository, useClass: MeterReadingPrismaRepository },
  { provide: ORDER_TOKENS.SubscriptionRepository, useClass: SubscriptionPrismaRepository },
  { provide: ORDER_TOKENS.ProductCatalog, useClass: ProductCatalogHttpAdapter },
  { provide: ORDER_TOKENS.DepotDirectory, useClass: DepotDirectoryHttpAdapter },
  { provide: ORDER_TOKENS.DepotPricing, useClass: DepotPricingHttpAdapter },
  { provide: ORDER_TOKENS.LoyaltyCoordination, useClass: LoyaltyCoordinationHttpAdapter },
  { provide: ORDER_TOKENS.ReferralCoordination, useClass: ReferralCoordinationHttpAdapter },
  {
    provide: ORDER_TOKENS.RecommendationCoordination,
    useClass: RecommendationCoordinationHttpAdapter,
  },
  { provide: ORDER_TOKENS.ForecastCoordination, useClass: ForecastCoordinationHttpAdapter },
  { provide: ORDER_TOKENS.FranchiseRevenue, useClass: FranchiseRevenueHttpAdapter },
  { provide: ORDER_TOKENS.GallonIssue, useClass: GallonIssueHttpAdapter },
  { provide: ORDER_TOKENS.CashierShift, useClass: CashierShiftHttpAdapter },
  { provide: ORDER_TOKENS.PaymentReversal, useClass: PaymentReversalHttpAdapter },
  { provide: ORDER_TOKENS.PaymentCash, useClass: PaymentCashHttpAdapter },
  { provide: ORDER_TOKENS.DeliverySla, useClass: DeliverySlaHttpAdapter },
  { provide: ORDER_TOKENS.DepotCosts, useClass: DepotCostsHttpAdapter },
  { provide: ORDER_TOKENS.Membership, useClass: MembershipHttpAdapter },
  { provide: ORDER_TOKENS.ResellerDiscount, useClass: ResellerDiscountHttpAdapter },
  { provide: ORDER_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: ORDER_TOKENS.Notification, useClass: NotificationHttpAdapter },
  { provide: ORDER_TOKENS.Promo, useClass: PromoHttpAdapter },
  { provide: ORDER_TOKENS.Inventory, useClass: InventoryHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    CartController,
    OrderController,
    MeterController,
    ReportController,
    SubscriptionController,
    SettingsController,
  ],
  providers,
  exports: [PrismaService, OrderConfigService],
})
export class OrderModule implements OnApplicationBootstrap {
  constructor(private readonly settingsCache: SettingsCache) {}

  async onApplicationBootstrap(): Promise<void> {
    // ponytail: fail-open — a boot-time DB hiccup must not crash the service; an
    // empty snapshot just means every getter falls through to its env default
    // (SettingsCache's own documented behavior), and the interval retries anyway.
    await this.settingsCache.refresh().catch(() => {});
    setInterval(() => {
      this.settingsCache.refresh().catch(() => {});
    }, this.settingsCache.ttl).unref();
  }
}
