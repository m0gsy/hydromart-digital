import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { OrderConfigService } from '../config/order-config.service';
import { ORDER_TOKENS } from '../application/tokens';
import { CartService } from '../application/services/cart.service';
import { OrderService } from '../application/services/order.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CartPrismaRepository } from '../infrastructure/prisma/cart.prisma.repository';
import { OrderPrismaRepository } from '../infrastructure/prisma/order.prisma.repository';
import { ProductCatalogHttpAdapter } from '../infrastructure/http/product-catalog.http.adapter';
import { CartController } from './cart.controller';
import { OrderController } from './order.controller';

const providers: Provider[] = [
  PrismaService,
  OrderConfigService,
  CartService,
  OrderService,
  { provide: ORDER_TOKENS.CartRepository, useClass: CartPrismaRepository },
  { provide: ORDER_TOKENS.OrderRepository, useClass: OrderPrismaRepository },
  { provide: ORDER_TOKENS.ProductCatalog, useClass: ProductCatalogHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [CartController, OrderController],
  providers,
  exports: [PrismaService, OrderConfigService],
})
export class OrderModule {}
