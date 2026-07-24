import { Module, OnApplicationBootstrap, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard, SettingsCache } from '@hydromart/platform';

import { DeliveryConfigService } from '../config/delivery-config.service';
import { DELIVERY_TOKENS } from '../application/tokens';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../application/ports/settings.repository';
import { DeliveryService } from '../application/services/delivery.service';
import { ReportService } from '../application/services/report.service';
import { ShiftService } from '../application/services/shift.service';
import { IncidentService } from '../application/services/incident.service';
import { SettlementService } from '../application/services/settlement.service';
import { PerformanceService } from '../application/services/performance.service';
import { CommissionService } from '../application/services/commission.service';
import { SettingsService } from '../application/services/settings.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { DeliveryPrismaRepository } from '../infrastructure/prisma/delivery.prisma.repository';
import { ShiftPrismaRepository } from '../infrastructure/prisma/shift.prisma.repository';
import { IncidentPrismaRepository } from '../infrastructure/prisma/incident.prisma.repository';
import { SettlementPrismaRepository } from '../infrastructure/prisma/settlement.prisma.repository';
import { SettingsPrismaRepository } from '../infrastructure/prisma/settings.prisma.repository';
import { OrderCoordinationHttpAdapter } from '../infrastructure/http/order-coordination.http.adapter';
import { CashCollectionHttpAdapter } from '../infrastructure/http/cash-collection.http.adapter';
import { CourierPayoutHttpAdapter } from '../infrastructure/http/courier-payout.http.adapter';
import { RatingHttpAdapter } from '../infrastructure/http/rating.http.adapter';
import { DepotLocationHttpAdapter } from '../infrastructure/http/depot-location.http.adapter';
import { OpsNotifierHttpAdapter } from '../infrastructure/http/ops-notifier.http.adapter';
import { LocalDiskStorageAdapter } from '../infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../infrastructure/storage/s3-storage.adapter';
import { StoragePort } from '../application/ports/storage.port';
import { DeliveryController } from './delivery.controller';
import { DriverDeliveryController } from './driver-delivery.controller';
import { DriverShiftController } from './driver-shift.controller';
import { DriverIncidentController } from './driver-incident.controller';
import { DriverSettlementController } from './driver-settlement.controller';
import { DriverPerformanceController } from './driver-performance.controller';
import { ShiftController } from './shift.controller';
import { SettlementController } from './settlement.controller';
import { CommissionController } from './commission.controller';
import { ReportController } from './report.controller';
import { UploadController } from './upload.controller';
import { RetentionController } from './retention.controller';
import { SettingsController } from './settings.controller';

const providers: Provider[] = [
  PrismaService,
  { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  {
    provide: SettingsCache,
    useFactory: (repo: SettingsRepository) => new SettingsCache(repo),
    inject: [SETTINGS_REPOSITORY],
  },
  DeliveryConfigService,
  DeliveryService,
  ReportService,
  ShiftService,
  IncidentService,
  SettlementService,
  PerformanceService,
  CommissionService,
  SettingsService,
  { provide: DELIVERY_TOKENS.DeliveryRepository, useClass: DeliveryPrismaRepository },
  { provide: DELIVERY_TOKENS.ShiftRepository, useClass: ShiftPrismaRepository },
  { provide: DELIVERY_TOKENS.IncidentRepository, useClass: IncidentPrismaRepository },
  { provide: DELIVERY_TOKENS.SettlementRepository, useClass: SettlementPrismaRepository },
  { provide: DELIVERY_TOKENS.OrderCoordination, useClass: OrderCoordinationHttpAdapter },
  { provide: DELIVERY_TOKENS.CashCollection, useClass: CashCollectionHttpAdapter },
  { provide: DELIVERY_TOKENS.CourierPayout, useClass: CourierPayoutHttpAdapter },
  { provide: DELIVERY_TOKENS.Rating, useClass: RatingHttpAdapter },
  { provide: DELIVERY_TOKENS.DepotLocation, useClass: DepotLocationHttpAdapter },
  { provide: DELIVERY_TOKENS.OpsNotifier, useClass: OpsNotifierHttpAdapter },
  {
    provide: DELIVERY_TOKENS.Storage,
    inject: [DeliveryConfigService],
    useFactory: (config: DeliveryConfigService): StoragePort =>
      config.storageDriver === 's3'
        ? new S3StorageAdapter(config)
        : new LocalDiskStorageAdapter(config),
  },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    DeliveryController,
    DriverDeliveryController,
    DriverShiftController,
    DriverIncidentController,
    DriverSettlementController,
    DriverPerformanceController,
    ShiftController,
    SettlementController,
    CommissionController,
    ReportController,
    UploadController,
    RetentionController,
    SettingsController,
  ],
  providers,
  exports: [PrismaService, DeliveryConfigService],
})
export class DeliveryModule implements OnApplicationBootstrap {
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
