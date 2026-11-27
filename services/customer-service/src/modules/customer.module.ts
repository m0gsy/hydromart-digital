import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { CustomerConfigService } from '../config/customer-config.service';
import { CUSTOMER_TOKENS } from '../application/tokens';
import { RegionLookup } from '../infrastructure/geo/region-lookup';
import { AddressService } from '../application/services/address.service';
import { NotificationService } from '../application/services/notification.service';
import { PaymentMethodService } from '../application/services/payment-method.service';
import { ProfileService } from '../application/services/profile.service';
import { DepotCrmService } from '../application/services/depot-crm.service';
import { FavoriteService } from '../application/services/favorite.service';
import { ResellerService } from '../application/services/reseller.service';
import { CustomerImportService } from '../application/services/customer-import.service';
import { B2bProspectIntakeService } from '../application/services/b2b-prospect-intake.service';
import { B2bProspectService } from '../application/services/b2b-prospect.service';
import { B2bProspectPrismaRepository } from '../infrastructure/prisma/b2b-prospect.prisma.repository';
import { StaffRosterHttpAdapter } from '../infrastructure/http/staff-roster.http.adapter';
import { UnservedDemandPrismaRepository } from '../infrastructure/prisma/unserved-demand.prisma.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { AddressPrismaRepository } from '../infrastructure/prisma/address.prisma.repository';
import { FavoritePrismaRepository } from '../infrastructure/prisma/favorite.prisma.repository';
import { NotificationPrismaRepository } from '../infrastructure/prisma/notification.prisma.repository';
import { PaymentMethodPrismaRepository } from '../infrastructure/prisma/payment-method.prisma.repository';
import { ProfilePrismaRepository } from '../infrastructure/prisma/profile.prisma.repository';
import { DepotCrmPrismaRepository } from '../infrastructure/prisma/depot-crm.prisma.repository';
import { PdpPrismaRepository } from '../infrastructure/prisma/pdp.prisma.repository';
import { ResellerPrismaRepository } from '../infrastructure/prisma/reseller.prisma.repository';
import { LoyaltyRewardHttpAdapter } from '../infrastructure/http/loyalty-reward.http.adapter';
import { ProductCatalogHttpAdapter } from '../infrastructure/http/product-catalog.http.adapter';
import { IdentityHttpAdapter } from '../infrastructure/http/identity.http.adapter';
import { ResellerNotificationHttpAdapter } from '../infrastructure/http/reseller-notification.http.adapter';
import { OrderCrmHttpAdapter } from '../infrastructure/http/order-crm.http.adapter';
import { DepotLedgerHttpAdapter } from '../infrastructure/http/depot-ledger.http.adapter';
import { DepotProfileHttpAdapter } from '../infrastructure/http/depot-profile.http.adapter';
import { ChurnRiskHttpAdapter } from '../infrastructure/http/churn-risk.http.adapter';
import { LocalDiskStorageAdapter } from '../infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../infrastructure/storage/s3-storage.adapter';
import { AddressController } from './address.controller';
import { PaymentMethodController } from './payment-method.controller';
import { ProfileController } from './profile.controller';
import { DepotCrmController } from './depot-crm.controller';
import { FavoriteController } from './favorite.controller';
import { ResellerSelfController } from './reseller-self.controller';
import { ResellerController } from './reseller.controller';
import { B2bProspectController } from './b2b-prospect.controller';
import { InternalController } from './internal.controller';
import { InternalRegionsController } from './internal-regions.controller';

const providers: Provider[] = [
  PrismaService,
  CustomerConfigService,
  ProfileService,
  AddressService,
  RegionLookup,
  NotificationService,
  PaymentMethodService,
  DepotCrmService,
  FavoriteService,
  ResellerService,
  CustomerImportService,
  B2bProspectService,
  B2bProspectIntakeService,
  { provide: CUSTOMER_TOKENS.ProfileRepository, useClass: ProfilePrismaRepository },
  { provide: CUSTOMER_TOKENS.AddressRepository, useClass: AddressPrismaRepository },
  {
    provide: CUSTOMER_TOKENS.NotificationPreferenceRepository,
    useClass: NotificationPrismaRepository,
  },
  { provide: CUSTOMER_TOKENS.PaymentMethodRepository, useClass: PaymentMethodPrismaRepository },
  { provide: CUSTOMER_TOKENS.LoyaltyRewardPort, useClass: LoyaltyRewardHttpAdapter },
  { provide: CUSTOMER_TOKENS.ProductCatalogPort, useClass: ProductCatalogHttpAdapter },
  { provide: CUSTOMER_TOKENS.DepotCrmRepository, useClass: DepotCrmPrismaRepository },
  { provide: CUSTOMER_TOKENS.OrderCrmPort, useClass: OrderCrmHttpAdapter },
  { provide: CUSTOMER_TOKENS.DepotLedgerPort, useClass: DepotLedgerHttpAdapter },
  { provide: CUSTOMER_TOKENS.DepotProfilePort, useClass: DepotProfileHttpAdapter },
  { provide: CUSTOMER_TOKENS.ChurnRiskPort, useClass: ChurnRiskHttpAdapter },
  { provide: CUSTOMER_TOKENS.FavoriteRepository, useClass: FavoritePrismaRepository },
  { provide: CUSTOMER_TOKENS.ResellerRepository, useClass: ResellerPrismaRepository },
  { provide: CUSTOMER_TOKENS.IdentityPort, useClass: IdentityHttpAdapter },
  { provide: CUSTOMER_TOKENS.ResellerNotification, useClass: ResellerNotificationHttpAdapter },
  { provide: CUSTOMER_TOKENS.PdpRepository, useClass: PdpPrismaRepository },
  { provide: CUSTOMER_TOKENS.UnservedDemandRepository, useClass: UnservedDemandPrismaRepository },
  { provide: CUSTOMER_TOKENS.B2bProspectRepository, useClass: B2bProspectPrismaRepository },
  { provide: CUSTOMER_TOKENS.StaffRoster, useClass: StaffRosterHttpAdapter },
  {
    provide: CUSTOMER_TOKENS.Storage,
    useFactory: (config: CustomerConfigService) =>
      config.storageDriver === 's3'
        ? new S3StorageAdapter(config)
        : new LocalDiskStorageAdapter(config),
    inject: [CustomerConfigService],
  },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    ProfileController,
    AddressController,
    PaymentMethodController,
    DepotCrmController,
    FavoriteController,
    ResellerSelfController,
    ResellerController,
    B2bProspectController,
    InternalController,
    InternalRegionsController,
  ],
  providers,
  exports: [PrismaService, CustomerConfigService],
})
export class CustomerModule {}
