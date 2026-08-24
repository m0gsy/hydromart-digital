import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard, DepotScopeGuard } from '@hydromart/platform';

import { PaymentConfigService } from '../config/payment-config.service';
import { LocalDiskStorageAdapter } from '../infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../infrastructure/storage/s3-storage.adapter';
import { StoragePort } from '../application/ports/storage.port';
import { PAYMENT_TOKENS } from '../application/tokens';
import { PaymentService } from '../application/services/payment.service';
import { TaxSettingsService } from '../application/services/tax-settings.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PaymentPrismaRepository } from '../infrastructure/prisma/payment.prisma.repository';
import { TaxSettingsPrismaRepository } from '../infrastructure/prisma/tax-settings.prisma.repository';
import { PaymentGatewayHttpAdapter } from '../infrastructure/http/payment-gateway.http.adapter';
import { OrderCoordinationHttpAdapter } from '../infrastructure/http/order-coordination.http.adapter';
import { CashierShiftHttpAdapter } from '../infrastructure/http/cashier-shift.http.adapter';
import { CASHIER_SHIFT_PORT } from '../application/ports/cashier-shift.port';
import { PaymentController } from './payment.controller';
import { TaxController } from './tax.controller';

const providers: Provider[] = [
  PrismaService,
  PaymentConfigService,
  PaymentService,
  TaxSettingsService,
  { provide: PAYMENT_TOKENS.PaymentRepository, useClass: PaymentPrismaRepository },
  { provide: PAYMENT_TOKENS.TaxSettingsRepository, useClass: TaxSettingsPrismaRepository },
  { provide: PAYMENT_TOKENS.PaymentGateway, useClass: PaymentGatewayHttpAdapter },
  { provide: PAYMENT_TOKENS.OrderCoordination, useClass: OrderCoordinationHttpAdapter },
  {
    provide: PAYMENT_TOKENS.Storage,
    inject: [PaymentConfigService],
    useFactory: (config: PaymentConfigService): StoragePort =>
      config.storageDriver === 's3'
        ? new S3StorageAdapter(config)
        : new LocalDiskStorageAdapter(config),
  },
  // C2: which drawer a counter payment lands in, asked with the cashier's own token.
  { provide: CASHIER_SHIFT_PORT, useClass: CashierShiftHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [PaymentController, TaxController],
  providers,
  exports: [PrismaService, PaymentConfigService],
})
export class PaymentModule {}
