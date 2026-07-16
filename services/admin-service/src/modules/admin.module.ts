import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { AdminConfigService } from '../config/admin-config.service';
import { ADMIN_TOKENS } from '../application/tokens';
import { FeatureFlagService } from '../application/services/feature-flag.service';
import { SystemSettingsService } from '../application/services/system-settings.service';
import { SystemHealthService } from '../application/services/system-health.service';
import { ApiKeyService } from '../application/services/api-key.service';
import { WebhookService } from '../application/services/webhook.service';
import { ExportLogService } from '../application/services/export-log.service';
import { ScheduledReportService } from '../application/services/scheduled-report.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { FeatureFlagPrismaRepository } from '../infrastructure/prisma/feature-flag.prisma.repository';
import { SystemSettingsPrismaRepository } from '../infrastructure/prisma/system-settings.prisma.repository';
import { ApiKeyPrismaRepository } from '../infrastructure/prisma/api-key.prisma.repository';
import { WebhookPrismaRepository } from '../infrastructure/prisma/webhook.prisma.repository';
import { ExportLogPrismaRepository } from '../infrastructure/prisma/export-log.prisma.repository';
import { ScheduledReportPrismaRepository } from '../infrastructure/prisma/scheduled-report.prisma.repository';
import { HealthProbeHttpAdapter } from '../infrastructure/http/health-probe.http.adapter';
import { FeatureFlagsController } from './feature-flags.controller';
import { SystemSettingsController } from './system-settings.controller';
import { SystemHealthController } from './system-health.controller';
import { ApiKeysController } from './api-keys.controller';
import { WebhooksController } from './webhooks.controller';
import { ExportLogsController } from './export-logs.controller';
import { ScheduledReportsController } from './scheduled-reports.controller';

const providers: Provider[] = [
  PrismaService,
  AdminConfigService,
  FeatureFlagService,
  SystemSettingsService,
  SystemHealthService,
  ApiKeyService,
  WebhookService,
  ExportLogService,
  ScheduledReportService,
  { provide: ADMIN_TOKENS.FeatureFlagRepository, useClass: FeatureFlagPrismaRepository },
  { provide: ADMIN_TOKENS.SystemSettingsRepository, useClass: SystemSettingsPrismaRepository },
  { provide: ADMIN_TOKENS.HealthProbe, useClass: HealthProbeHttpAdapter },
  { provide: ADMIN_TOKENS.ApiKeyRepository, useClass: ApiKeyPrismaRepository },
  { provide: ADMIN_TOKENS.WebhookRepository, useClass: WebhookPrismaRepository },
  { provide: ADMIN_TOKENS.ExportLogRepository, useClass: ExportLogPrismaRepository },
  { provide: ADMIN_TOKENS.ScheduledReportRepository, useClass: ScheduledReportPrismaRepository },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    FeatureFlagsController,
    SystemSettingsController,
    SystemHealthController,
    ApiKeysController,
    WebhooksController,
    ExportLogsController,
    ScheduledReportsController,
  ],
  providers,
  exports: [PrismaService, AdminConfigService],
})
export class AdminModule {}
