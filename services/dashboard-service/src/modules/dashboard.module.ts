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
import { DashboardSourcesHttpAdapter } from '../infrastructure/http/dashboard-sources.http.adapter';
import { DashboardController } from './dashboard.controller';
import { PendingApprovalsController } from './pending-approvals.controller';
import { PendingApprovalsService } from '../application/services/pending-approvals.service';
import { AiReadController } from './ai-read.controller';
import { ReadScopeService } from '../application/ai-read/scope.service';
import { AiReadSourcesHttpAdapter } from '../infrastructure/http/ai-read-sources.http.adapter';
import { PendingApprovalSourcesHttpAdapter } from '../infrastructure/http/pending-approval-sources.http.adapter';

const providers: Provider[] = [
  DashboardConfigService,
  DashboardService,
  { provide: DASHBOARD_TOKENS.Sources, useClass: DashboardSourcesHttpAdapter },
  ReadScopeService,
  { provide: DASHBOARD_TOKENS.AiReadSources, useClass: AiReadSourcesHttpAdapter },
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
  controllers: [DashboardController, PendingApprovalsController, AiReadController],
  providers,
  exports: [DashboardConfigService],
})
export class DashboardModule {}
