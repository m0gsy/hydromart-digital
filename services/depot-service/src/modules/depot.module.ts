import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { DepotConfigService } from '../config/depot-config.service';
import { DEPOT_TOKENS } from '../application/tokens';
import { DepotService } from '../application/services/depot.service';
import { InventoryService } from '../application/services/inventory.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { DepotPrismaRepository } from '../infrastructure/prisma/depot.prisma.repository';
import { InventoryPrismaRepository } from '../infrastructure/prisma/inventory.prisma.repository';
import { DepotController } from './depot.controller';
import { DepotInventoryController, InventoryController } from './inventory.controller';

const providers: Provider[] = [
  PrismaService,
  DepotConfigService,
  DepotService,
  InventoryService,
  { provide: DEPOT_TOKENS.DepotRepository, useClass: DepotPrismaRepository },
  { provide: DEPOT_TOKENS.InventoryRepository, useClass: InventoryPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [DepotController, DepotInventoryController, InventoryController],
  providers,
  exports: [PrismaService, DepotConfigService],
})
export class DepotModule {}
