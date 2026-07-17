import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { DepotConfigService } from '../config/depot-config.service';
import { DEPOT_TOKENS } from '../application/tokens';
import { DepotService } from '../application/services/depot.service';
import { InventoryService } from '../application/services/inventory.service';
import { PricingService } from '../application/services/pricing.service';
import { GallonReturnService } from '../application/services/gallon-return.service';
import { GallonIssueService } from '../application/services/gallon-issue.service';
import { GallonNetworkService } from '../application/services/gallon-network.service';
import { FranchiseApplicationService } from '../application/services/franchise-application.service';
import { PriceOverrideService } from '../application/services/price-override.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { DepotPrismaRepository } from '../infrastructure/prisma/depot.prisma.repository';
import { InventoryPrismaRepository } from '../infrastructure/prisma/inventory.prisma.repository';
import { PricingRulePrismaRepository } from '../infrastructure/prisma/pricing-rule.prisma.repository';
import { GallonReturnPrismaRepository } from '../infrastructure/prisma/gallon-return.prisma.repository';
import { GallonIssuePrismaRepository } from '../infrastructure/prisma/gallon-issue.prisma.repository';
import { FranchiseApplicationPrismaRepository } from '../infrastructure/prisma/franchise-application.prisma.repository';
import { PriceOverrideProposalPrismaRepository } from '../infrastructure/prisma/price-override-proposal.prisma.repository';
import { LowStockAlertHttpAdapter } from '../infrastructure/http/low-stock-alert.http.adapter';
import { DepotController } from './depot.controller';
import { DepotInventoryController, InventoryController } from './inventory.controller';
import { PricingController } from './pricing.controller';
import { GallonReturnController } from './gallon-return.controller';
import { DriverGallonReturnController } from './driver-gallon-return.controller';
import { GallonIssueController } from './gallon-issue.controller';
import { GallonNetworkController } from './gallon-network.controller';
import { FranchiseApplicationController } from './franchise-application.controller';
import {
  DepotPriceOverrideController,
  PriceOverrideController,
} from './price-override.controller';

const providers: Provider[] = [
  PrismaService,
  DepotConfigService,
  DepotService,
  InventoryService,
  PricingService,
  GallonReturnService,
  GallonIssueService,
  GallonNetworkService,
  FranchiseApplicationService,
  PriceOverrideService,
  { provide: DEPOT_TOKENS.DepotRepository, useClass: DepotPrismaRepository },
  { provide: DEPOT_TOKENS.InventoryRepository, useClass: InventoryPrismaRepository },
  { provide: DEPOT_TOKENS.PricingRuleRepository, useClass: PricingRulePrismaRepository },
  { provide: DEPOT_TOKENS.GallonReturnRepository, useClass: GallonReturnPrismaRepository },
  { provide: DEPOT_TOKENS.GallonIssueRepository, useClass: GallonIssuePrismaRepository },
  {
    provide: DEPOT_TOKENS.FranchiseApplicationRepository,
    useClass: FranchiseApplicationPrismaRepository,
  },
  {
    provide: DEPOT_TOKENS.PriceOverrideProposalRepository,
    useClass: PriceOverrideProposalPrismaRepository,
  },
  { provide: DEPOT_TOKENS.LowStockAlert, useClass: LowStockAlertHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    DepotController,
    DepotInventoryController,
    InventoryController,
    PricingController,
    GallonReturnController,
    DriverGallonReturnController,
    GallonIssueController,
    GallonNetworkController,
    FranchiseApplicationController,
    DepotPriceOverrideController,
    PriceOverrideController,
  ],
  providers,
  exports: [PrismaService, DepotConfigService],
})
export class DepotModule {}
