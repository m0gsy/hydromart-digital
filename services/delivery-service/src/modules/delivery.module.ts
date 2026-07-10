import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { DeliveryConfigService } from '../config/delivery-config.service';
import { DELIVERY_TOKENS } from '../application/tokens';
import { DeliveryService } from '../application/services/delivery.service';
import { ReportService } from '../application/services/report.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { DeliveryPrismaRepository } from '../infrastructure/prisma/delivery.prisma.repository';
import { OrderCoordinationHttpAdapter } from '../infrastructure/http/order-coordination.http.adapter';
import { DeliveryController } from './delivery.controller';
import { DriverDeliveryController } from './driver-delivery.controller';
import { ReportController } from './report.controller';

const providers: Provider[] = [
  PrismaService,
  DeliveryConfigService,
  DeliveryService,
  ReportService,
  { provide: DELIVERY_TOKENS.DeliveryRepository, useClass: DeliveryPrismaRepository },
  { provide: DELIVERY_TOKENS.OrderCoordination, useClass: OrderCoordinationHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [DeliveryController, DriverDeliveryController, ReportController],
  providers,
  exports: [PrismaService, DeliveryConfigService],
})
export class DeliveryModule {}
