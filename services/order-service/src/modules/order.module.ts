import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import {
  AUDIT_MUTATION_SINK,
  JwtAuthGuard,
  RolesGuard,
  DepotScopeGuard,
  SettingsCache,
  httpFeatureFlagReader,
} from '@hydromart/platform';

import { OrderConfigService } from '../config/order-config.service';
import { ORDER_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { CartService } from '../application/services/cart.service';
import { OrderService } from '../application/services/order.service';
import { OutboxService } from '../application/services/outbox.service';
import { EventRelayService } from '../application/services/event-relay.service';
import { MeterService } from '../application/services/meter.service';
import { ReportService } from '../application/services/report.service';
import { SubscriptionService } from '../application/services/subscription.service';
import { SettingsService } from '../application/services/settings.service';
import { SalesImportService } from '../application/services/sales-import.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CartPrismaRepository } from '../infrastructure/prisma/cart.prisma.repository';
import { MeterReadingPrismaRepository } from '../infrastructure/prisma/meter-reading.prisma.repository';
import { OrderPrismaRepository } from '../infrastructure/prisma/order.prisma.repository';
import { OutboxPrismaRepository } from '../infrastructure/prisma/outbox.prisma.repository';
import { EventOutboxPrismaRepository } from '../infrastructure/prisma/event-outbox.prisma.repository';
import { EventPublisherHttpAdapter } from '../infrastructure/http/event-publisher.http.adapter';
import { SubscriptionPrismaRepository } from '../infrastructure/prisma/subscription.prisma.repository';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { SalesImportPrismaRepository } from '../infrastructure/prisma/sales-import.prisma.repository';
import { ProductCatalogHttpAdapter } from '../infrastructure/http/product-catalog.http.adapter';
import { DepotDirectoryHttpAdapter } from '../infrastructure/http/depot-directory.http.adapter';
import { AccountNamesHttpAdapter } from '../infrastructure/http/account-names.http.adapter';
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
import { TaxRateHttpAdapter } from '../infrastructure/http/tax-rate.http.adapter';
import { DeliverySlaHttpAdapter } from '../infrastructure/http/delivery-sla.http.adapter';
import { DepotCostsHttpAdapter } from '../infrastructure/http/depot-costs.http.adapter';
import { MembershipHttpAdapter } from '../infrastructure/http/membership.http.adapter';
import { ResellerDiscountHttpAdapter } from '../infrastructure/http/reseller-discount.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../infrastructure/http/customer-directory.http.adapter';
import { NotificationHttpAdapter } from '../infrastructure/http/notification.http.adapter';
import { PromoHttpAdapter } from '../infrastructure/http/promo.http.adapter';
import { PromoAutoApplyHttpAdapter } from '../infrastructure/http/promo-auto-apply.http.adapter';
import { InventoryHttpAdapter } from '../infrastructure/http/inventory.http.adapter';
import { CartController } from './cart.controller';
import { OrderController } from './order.controller';
import { MeterController } from './meter.controller';
import { AiEngagementService } from '../application/services/ai-engagement.service';
import { AI_ENGAGEMENT_REPOSITORY } from '../application/ports/ai-engagement.repository';
import { AiEngagementPrismaRepository } from '../infrastructure/prisma/ai-engagement.prisma.repository';
import { AiEngagementController } from './ai-engagement.controller';
import { ReportController } from './report.controller';
import { SubscriptionController } from './subscription.controller';
import { SettingsController } from './settings.controller';
import { SalesImportController } from './sales-import.controller';
import { AiCustomerMetricsController } from './ai-customer-metrics.controller';
import { AiCustomerMetricsService } from '../application/services/ai-customer-metrics.service';
import { AiCustomerPrismaRepository } from '../infrastructure/prisma/ai-customer.prisma.repository';
import { CustomerOutreachService } from '../application/services/customer-outreach.service';
import { CUSTOMER_OUTREACH_REPOSITORY } from '../application/ports/customer-outreach.repository';
import { CustomerOutreachPrismaRepository } from '../infrastructure/prisma/customer-outreach.prisma.repository';
import {
  AccountByPhoneHttpAdapter,
  PaymentsOfOrdersHttpAdapter,
} from '../infrastructure/http/outreach-lookups.http.adapter';
import { OrderAuditSink } from '../infrastructure/http/order-audit.sink';
import { CustomerRemindersInternalController, MachineOrdersController } from './customer-outreach.controller';

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
  EventRelayService,
  MeterService,
  ReportService,
  AiEngagementService,
  { provide: AI_ENGAGEMENT_REPOSITORY, useClass: AiEngagementPrismaRepository },
  SubscriptionService,
  SettingsService,
  SalesImportService,
  AiCustomerMetricsService,
  // HD-18: the n8n machine routes (order status per number, who to remind) and their audit trail.
  CustomerOutreachService,
  { provide: CUSTOMER_OUTREACH_REPOSITORY, useClass: CustomerOutreachPrismaRepository },
  { provide: ORDER_TOKENS.AccountByPhone, useClass: AccountByPhoneHttpAdapter },
  { provide: ORDER_TOKENS.PaymentsOfOrders, useClass: PaymentsOfOrdersHttpAdapter },
  { provide: AUDIT_MUTATION_SINK, useClass: OrderAuditSink },
  { provide: ORDER_TOKENS.AiCustomerRepository, useClass: AiCustomerPrismaRepository },
  { provide: ORDER_TOKENS.SalesImportRepository, useClass: SalesImportPrismaRepository },
  { provide: ORDER_TOKENS.CartRepository, useClass: CartPrismaRepository },
  { provide: ORDER_TOKENS.OrderRepository, useClass: OrderPrismaRepository },
  { provide: ORDER_TOKENS.OutboxRepository, useClass: OutboxPrismaRepository },
  { provide: ORDER_TOKENS.EventOutbox, useClass: EventOutboxPrismaRepository },
  { provide: ORDER_TOKENS.EventTransport, useClass: EventPublisherHttpAdapter },
  { provide: ORDER_TOKENS.MeterReadingRepository, useClass: MeterReadingPrismaRepository },
  { provide: ORDER_TOKENS.SubscriptionRepository, useClass: SubscriptionPrismaRepository },
  { provide: ORDER_TOKENS.ProductCatalog, useClass: ProductCatalogHttpAdapter },
  { provide: ORDER_TOKENS.DepotDirectory, useClass: DepotDirectoryHttpAdapter },
  { provide: ORDER_TOKENS.AccountNames, useClass: AccountNamesHttpAdapter },
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
  { provide: ORDER_TOKENS.TaxRate, useClass: TaxRateHttpAdapter },
  {
    provide: ORDER_TOKENS.FeatureFlags,
    inject: [OrderConfigService],
    useFactory: (config: OrderConfigService) =>
      httpFeatureFlagReader({ adminServiceUrl: config.adminServiceUrl }),
  },
  { provide: ORDER_TOKENS.DeliverySla, useClass: DeliverySlaHttpAdapter },
  { provide: ORDER_TOKENS.DepotCosts, useClass: DepotCostsHttpAdapter },
  { provide: ORDER_TOKENS.Membership, useClass: MembershipHttpAdapter },
  { provide: ORDER_TOKENS.ResellerDiscount, useClass: ResellerDiscountHttpAdapter },
  { provide: ORDER_TOKENS.CustomerDirectory, useClass: CustomerDirectoryHttpAdapter },
  { provide: ORDER_TOKENS.Notification, useClass: NotificationHttpAdapter },
  { provide: ORDER_TOKENS.Promo, useClass: PromoHttpAdapter },
  { provide: ORDER_TOKENS.PromoAutoApply, useClass: PromoAutoApplyHttpAdapter },
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
    AiEngagementController,
    SubscriptionController,
    SettingsController,
    SalesImportController,
    AiCustomerMetricsController,
    MachineOrdersController,
    CustomerRemindersInternalController,
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
