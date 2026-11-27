import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import {
  DepotScopeGuard,
  JwtAuthGuard,
  RolesGuard,
  httpAccountNameResolver,
} from '@hydromart/platform';

import { DashboardConfigService } from '../config/dashboard-config.service';
import { DASHBOARD_TOKENS } from '../application/tokens';
import { DashboardService } from '../application/services/dashboard.service';
import { LegalEntityPnlService } from '../application/services/legal-entity-pnl.service';
import { DashboardSourcesHttpAdapter } from '../infrastructure/http/dashboard-sources.http.adapter';
import { DashboardController } from './dashboard.controller';
import { PendingApprovalsController } from './pending-approvals.controller';
import { PendingApprovalsInternalController } from './pending-approvals-internal.controller';
import { PendingApprovalsService } from '../application/services/pending-approvals.service';
import { AiReadController } from './ai-read.controller';
import { MachineReadAuditInterceptor } from './machine-read-audit.interceptor';
import { ReadScopeService } from '../application/ai-read/scope.service';
import { AiReadSourcesHttpAdapter } from '../infrastructure/http/ai-read-sources.http.adapter';
import { AiMoneySourcesHttpAdapter } from '../infrastructure/http/ai-money-sources.http.adapter';
import { MoneyMetricsService } from '../application/ai-read/money-metrics';
import { AiReadStockController } from './ai-read-stock.controller';
import { StockMetricsService } from '../application/ai-read/stock-metrics';
import { LoyaltyMetricsService } from '../application/ai-read/loyalty-metrics';
import { AiStockSourcesHttpAdapter } from '../infrastructure/http/ai-stock-sources.http.adapter';
import { AiLoyaltySourcesHttpAdapter } from '../infrastructure/http/ai-loyalty-sources.http.adapter';
import { FranchiseMetricsService } from '../application/ai-read/franchise-metrics';
import { HrMetricsService } from '../application/ai-read/hr-metrics';
import { AiOrgSourcesHttpAdapter } from '../infrastructure/http/ai-org-sources.http.adapter';
import { AiReadCustomerController } from './ai-read-customer.controller';
import { AiReadAreaController } from './ai-read-area.controller';
import { AreaMetricsService } from '../application/ai-read/area-metrics';
import { AiAreaSourcesHttpAdapter } from '../infrastructure/http/ai-area-sources.http.adapter';
import { AiReadProspectController } from './ai-read-prospect.controller';
import { ProspectMetricsService } from '../application/ai-read/prospect-metrics';
import { AiProspectSourcesHttpAdapter } from '../infrastructure/http/ai-prospect-sources.http.adapter';
import { CumulativeScopeService } from '../application/ai-read/cumulative-scope.service';
import { CustomerMetricsService } from '../application/ai-read/customer-metrics';
import { DeliveryMetricsService } from '../application/ai-read/delivery-metrics';
import { GallonMetricsService } from '../application/ai-read/gallon-metrics';
import { TargetMetricsService } from '../application/ai-read/target-metrics';
import { AiCustomerSourcesHttpAdapter } from '../infrastructure/http/ai-customer-sources.http.adapter';
import { PendingApprovalSourcesHttpAdapter } from '../infrastructure/http/pending-approval-sources.http.adapter';

const providers: Provider[] = [
  DashboardConfigService,
  DashboardService,
  LegalEntityPnlService,
  { provide: DASHBOARD_TOKENS.Sources, useClass: DashboardSourcesHttpAdapter },
  ReadScopeService,
  MachineReadAuditInterceptor,
  { provide: DASHBOARD_TOKENS.AiReadSources, useClass: AiReadSourcesHttpAdapter },
  { provide: DASHBOARD_TOKENS.AiMoneySources, useClass: AiMoneySourcesHttpAdapter },
  { provide: DASHBOARD_TOKENS.AiOrgSources, useClass: AiOrgSourcesHttpAdapter },
  MoneyMetricsService,
  { provide: DASHBOARD_TOKENS.AiStockSources, useClass: AiStockSourcesHttpAdapter },
  StockMetricsService,
  { provide: DASHBOARD_TOKENS.AiLoyaltySources, useClass: AiLoyaltySourcesHttpAdapter },
  LoyaltyMetricsService,
  FranchiseMetricsService,
  HrMetricsService,
  { provide: DASHBOARD_TOKENS.AiCustomerSources, useClass: AiCustomerSourcesHttpAdapter },
  { provide: DASHBOARD_TOKENS.AiAreaSources, useClass: AiAreaSourcesHttpAdapter },
  AreaMetricsService,
  { provide: DASHBOARD_TOKENS.AiProspectSources, useClass: AiProspectSourcesHttpAdapter },
  ProspectMetricsService,
  CumulativeScopeService,
  CustomerMetricsService,
  DeliveryMetricsService,
  GallonMetricsService,
  TargetMetricsService,
  PendingApprovalsService,
  { provide: DASHBOARD_TOKENS.PendingApprovalSources, useClass: PendingApprovalSourcesHttpAdapter },
  {
    provide: DASHBOARD_TOKENS.AccountNames,
    inject: [DashboardConfigService],
    useFactory: (config: DashboardConfigService) =>
      httpAccountNameResolver({
        authServiceUrl: config.authServiceUrl,
        internalKey: config.internalServiceKey,
      }),
  },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: DepotScopeGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    DashboardController,
    PendingApprovalsController,
    AiReadController,
    AiReadStockController,
    AiReadCustomerController,
    AiReadAreaController,
    AiReadProspectController,
    PendingApprovalsInternalController,
  ],
  providers,
  exports: [DashboardConfigService],
})
export class DashboardModule {}
