import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { DashboardConfigService } from '../config/dashboard-config.service';
import { DASHBOARD_TOKENS } from '../application/tokens';
import { DashboardService } from '../application/services/dashboard.service';
import { DashboardSourcesHttpAdapter } from '../infrastructure/http/dashboard-sources.http.adapter';
import { DashboardController } from './dashboard.controller';

const providers: Provider[] = [
  DashboardConfigService,
  DashboardService,
  { provide: DASHBOARD_TOKENS.Sources, useClass: DashboardSourcesHttpAdapter },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [DashboardController],
  providers,
  exports: [DashboardConfigService],
})
export class DashboardModule {}
