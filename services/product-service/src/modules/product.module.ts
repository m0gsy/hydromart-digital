import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { DepotScopeGuard, JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { ProductConfigService } from '../config/product-config.service';
import { PRODUCT_TOKENS } from '../application/tokens';
import { CategoryService } from '../application/services/category.service';
import { ProductService } from '../application/services/product.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { CategoryPrismaRepository } from '../infrastructure/prisma/category.prisma.repository';
import { ProductPrismaRepository } from '../infrastructure/prisma/product.prisma.repository';
import { LocalDiskStorageAdapter } from '../infrastructure/storage/local-disk-storage.adapter';
import { StockNotifierHttpAdapter } from '../infrastructure/http/stock-notifier.http.adapter';
import { S3StorageAdapter } from '../infrastructure/storage/s3-storage.adapter';
import { StoragePort } from '../application/ports/storage.port';
import { CategoryController } from './category.controller';
import { ProductController } from './product.controller';
import { UploadController } from './upload.controller';

const providers: Provider[] = [
  PrismaService,
  ProductConfigService,
  ProductService,
  CategoryService,
  { provide: PRODUCT_TOKENS.ProductRepository, useClass: ProductPrismaRepository },
  { provide: PRODUCT_TOKENS.CategoryRepository, useClass: CategoryPrismaRepository },
  { provide: PRODUCT_TOKENS.StockNotifier, useClass: StockNotifierHttpAdapter },
  {
    provide: PRODUCT_TOKENS.Storage,
    inject: [ProductConfigService],
    useFactory: (config: ProductConfigService): StoragePort =>
      config.storageDriver === 's3'
        ? new S3StorageAdapter(config)
        : new LocalDiskStorageAdapter(config),
  },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  // Registered even though neither controller takes a `depotId` today: the next
  // depot-scoped route added here would otherwise be born unguarded, and nothing in the
  // service would say so. `scripts/check-depot-scope-guards.mjs` keeps every service
  // holding this line.
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [ProductController, CategoryController, UploadController],
  providers,
  exports: [PrismaService, ProductConfigService],
})
export class ProductModule {}
