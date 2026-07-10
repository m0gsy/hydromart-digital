import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { OrderConfigService } from '../config/order-config.service';
import { ORDER_TOKENS } from '../application/tokens';
import { CartService } from '../application/services/cart.service';
import { OrderService } from '../application/services/order.service';
import { ReportService } from '../application/services/report.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CartPrismaRepository } from '../infrastructure/prisma/cart.prisma.repository';
import { OrderPrismaRepository } from '../infrastructure/prisma/order.prisma.repository';
import { ProductCatalogHttpAdapter } from '../infrastructure/http/product-catalog.http.adapter';
import { DepotDirectoryHttpAdapter } from '../infrastructure/http/depot-directory.http.adapter';
import { LoyaltyCoordinationHttpAdapter } from '../infrastructure/http/loyalty-coordination.http.adapter';
import { PromoHttpAdapter } from '../infrastructure/http/promo.http.adapter';
import { CartController } from './cart.controller';
import { OrderController } from './order.controller';
import { ReportController } from './report.controller';

const providers: Provider[] = [
  PrismaService,
  OrderConfigService,
  CartService,
  OrderService,
  ReportService,
  { provide: ORDER_TOKENS.CartRepository, useClass: CartPrismaRepository },
  { provide: ORDER_TOKENS.OrderRepository, useClass: OrderPrismaRepository },
  { provide: ORDER_TOKENS.ProductCatalog, useClass: ProductCatalogHttpAdapter },
  { provide: ORDER_TOKENS.DepotDirectory, useClass: DepotDirectoryHttpAdapter },
  { provide: ORDER_TOKENS.LoyaltyCoordination, useClass: LoyaltyCoordinationHttpAdapter },
  { provide: ORDER_TOKENS.Promo, useClass: PromoHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [CartController, OrderController, ReportController],
  providers,
  exports: [PrismaService, OrderConfigService],
})
export class OrderModule {}
