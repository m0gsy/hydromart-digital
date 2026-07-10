import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { PaymentConfigService } from '../config/payment-config.service';
import { PAYMENT_TOKENS } from '../application/tokens';
import { PaymentService } from '../application/services/payment.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { PaymentPrismaRepository } from '../infrastructure/prisma/payment.prisma.repository';
import { PaymentGatewayHttpAdapter } from '../infrastructure/http/payment-gateway.http.adapter';
import { PaymentController } from './payment.controller';

const providers: Provider[] = [
  PrismaService,
  PaymentConfigService,
  PaymentService,
  { provide: PAYMENT_TOKENS.PaymentRepository, useClass: PaymentPrismaRepository },
  { provide: PAYMENT_TOKENS.PaymentGateway, useClass: PaymentGatewayHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [PaymentController],
  providers,
  exports: [PrismaService, PaymentConfigService],
})
export class PaymentModule {}
