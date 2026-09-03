import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import {
  AUDIT_MUTATION_SINK,
  AuditMutationsInterceptor,
  DepotScopeGuard,
  JwtAuthGuard,
  RolesGuard,
} from '@hydromart/platform';

import { AdminAuditSink } from '../infrastructure/http/audit.sink';
import { AccountSuspensionHttpAdapter } from '../infrastructure/http/account-suspension.http.adapter';

import { AdminConfigService } from '../config/admin-config.service';
import { PurgeService } from '../application/services/purge.service';
import { purgeExecutorProvider } from '../infrastructure/http/purge-executor.registry';
import { ADMIN_TOKENS } from '../application/tokens';
import { FeatureFlagService } from '../application/services/feature-flag.service';
import { SystemSettingsService } from '../application/services/system-settings.service';
import { SystemHealthService } from '../application/services/system-health.service';
import { ApiKeyService } from '../application/services/api-key.service';
import { WebhookService } from '../application/services/webhook.service';
import { WebhookDispatchService } from '../application/services/webhook-dispatch.service';
import { ExportLogService } from '../application/services/export-log.service';
import { ScheduledReportService } from '../application/services/scheduled-report.service';
import { ScheduledReportRunnerService } from '../application/services/scheduled-report-runner.service';
import { SupportTicketService } from '../application/services/support-ticket.service';
import { FraudFlagService } from '../application/services/fraud-flag.service';
import { FraudScanService } from '../application/services/fraud-scan.service';
import { IncidentService } from '../application/services/incident.service';
import { SlaPolicyService } from '../application/services/sla-policy.service';
import { RetentionService } from '../application/services/retention.service';
import { SecurityPolicyService } from '../application/services/security-policy.service';
import { AdminNotificationPrefService } from '../application/services/admin-notification-pref.service';
import { OnboardingStateService } from '../application/services/onboarding-state.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { FeatureFlagPrismaRepository } from '../infrastructure/prisma/feature-flag.prisma.repository';
import { SystemSettingsPrismaRepository } from '../infrastructure/prisma/system-settings.prisma.repository';
import { ApiKeyPrismaRepository } from '../infrastructure/prisma/api-key.prisma.repository';
import { WebhookPrismaRepository } from '../infrastructure/prisma/webhook.prisma.repository';
import { WebhookDeliveryPrismaRepository } from '../infrastructure/prisma/webhook-delivery.prisma.repository';
import { ExportLogPrismaRepository } from '../infrastructure/prisma/export-log.prisma.repository';
import { ScheduledReportPrismaRepository } from '../infrastructure/prisma/scheduled-report.prisma.repository';
import { ReportSourceHttpAdapter } from '../infrastructure/http/report-source.http.adapter';
import { SupportTicketPrismaRepository } from '../infrastructure/prisma/support-ticket.prisma.repository';
import { FraudFlagPrismaRepository } from '../infrastructure/prisma/fraud-flag.prisma.repository';
import { FraudSignalsHttpAdapter } from '../infrastructure/http/fraud-signals.http.adapter';
import { IncidentPrismaRepository } from '../infrastructure/prisma/incident.prisma.repository';
import { SlaPolicyPrismaRepository } from '../infrastructure/prisma/sla-policy.prisma.repository';
import { RetentionPrismaRepository } from '../infrastructure/prisma/retention.prisma.repository';
import { SecurityPolicyPrismaRepository } from '../infrastructure/prisma/security-policy.prisma.repository';
import { AdminNotificationPrefPrismaRepository } from '../infrastructure/prisma/admin-notification-pref.prisma.repository';
import { OnboardingStatePrismaRepository } from '../infrastructure/prisma/onboarding-state.prisma.repository';
import { HealthProbeHttpAdapter } from '../infrastructure/http/health-probe.http.adapter';
import { FeatureFlagsController } from './feature-flags.controller';
import { SystemSettingsController } from './system-settings.controller';
import { SystemHealthController } from './system-health.controller';
import { ApiKeysController } from './api-keys.controller';
import { WebhooksController } from './webhooks.controller';
import {
  PartnerDeliveryController,
  WebhookDeliveryController,
  WebhookInternalController,
} from './webhook-delivery.controller';
import { ExportLogsController } from './export-logs.controller';
import { ScheduledReportsController } from './scheduled-reports.controller';
import { SupportTicketsController } from './support-tickets.controller';
import { CustomerSupportController } from './customer-support.controller';
import { FraudFlagsController } from './fraud-flags.controller';
import { IncidentsController } from './incidents.controller';
import { SlaPolicyController } from './sla-policy.controller';
import { RetentionController } from './retention.controller';
import { SweepController } from './sweep.controller';
import { SweepService } from '../application/services/sweep.service';
import { SweepRunPrismaRepository } from '../infrastructure/prisma/sweep-run.prisma.repository';
import { SecurityPolicyController } from './security-policy.controller';
import { NotificationPrefsController } from './notification-prefs.controller';
import { OnboardingController } from './onboarding.controller';

const providers: Provider[] = [
  PrismaService,
  AdminConfigService,
  FeatureFlagService,
  SystemSettingsService,
  SystemHealthService,
  ApiKeyService,
  WebhookService,
  WebhookDispatchService,
  ExportLogService,
  ScheduledReportService,
  ScheduledReportRunnerService,
  SupportTicketService,
  FraudFlagService,
  FraudScanService,
  IncidentService,
  SlaPolicyService,
  RetentionService,
  SecurityPolicyService,
  AdminNotificationPrefService,
  OnboardingStateService,
  { provide: ADMIN_TOKENS.FeatureFlagRepository, useClass: FeatureFlagPrismaRepository },
  { provide: ADMIN_TOKENS.SystemSettingsRepository, useClass: SystemSettingsPrismaRepository },
  { provide: ADMIN_TOKENS.HealthProbe, useClass: HealthProbeHttpAdapter },
  { provide: ADMIN_TOKENS.ApiKeyRepository, useClass: ApiKeyPrismaRepository },
  { provide: ADMIN_TOKENS.WebhookRepository, useClass: WebhookPrismaRepository },
  {
    provide: ADMIN_TOKENS.WebhookDeliveryRepository,
    useClass: WebhookDeliveryPrismaRepository,
  },
  { provide: ADMIN_TOKENS.ExportLogRepository, useClass: ExportLogPrismaRepository },
  { provide: ADMIN_TOKENS.ScheduledReportRepository, useClass: ScheduledReportPrismaRepository },
  { provide: ADMIN_TOKENS.ReportSource, useClass: ReportSourceHttpAdapter },
  { provide: ADMIN_TOKENS.SupportTicketRepository, useClass: SupportTicketPrismaRepository },
  { provide: ADMIN_TOKENS.FraudFlagRepository, useClass: FraudFlagPrismaRepository },
  { provide: ADMIN_TOKENS.FraudSignals, useClass: FraudSignalsHttpAdapter },
  { provide: ADMIN_TOKENS.IncidentRepository, useClass: IncidentPrismaRepository },
  { provide: ADMIN_TOKENS.SlaPolicyRepository, useClass: SlaPolicyPrismaRepository },
  { provide: ADMIN_TOKENS.RetentionRepository, useClass: RetentionPrismaRepository },
  purgeExecutorProvider,
  PurgeService,
  { provide: ADMIN_TOKENS.SecurityPolicyRepository, useClass: SecurityPolicyPrismaRepository },
  {
    provide: ADMIN_TOKENS.AdminNotificationPrefRepository,
    useClass: AdminNotificationPrefPrismaRepository,
  },
  { provide: ADMIN_TOKENS.OnboardingStateRepository, useClass: OnboardingStatePrismaRepository },
  SweepService,
  { provide: ADMIN_TOKENS.SweepRunRepository, useClass: SweepRunPrismaRepository },
  // CA-2-67: the trail this service never had. The interceptor is attached per
  // controller (see @UseInterceptors on the privileged ones) rather than globally, so
  // the partner webhook ingest and the internal machine routes do not flood it.
  { provide: AUDIT_MUTATION_SINK, useClass: AdminAuditSink },
  // CA-2-05: "Blokir" in the fraud queue now reaches the account. Fails closed.
  { provide: ADMIN_TOKENS.AccountSuspension, useClass: AccountSuspensionHttpAdapter },
  AuditMutationsInterceptor,
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
  controllers: [
    FeatureFlagsController,
    SystemSettingsController,
    SystemHealthController,
    ApiKeysController,
    WebhooksController,
    WebhookInternalController,
    WebhookDeliveryController,
    PartnerDeliveryController,
    ExportLogsController,
    ScheduledReportsController,
    SupportTicketsController,
    CustomerSupportController,
    FraudFlagsController,
    IncidentsController,
    SlaPolicyController,
    RetentionController,
    SweepController,
    SecurityPolicyController,
    NotificationPrefsController,
    OnboardingController,
  ],
  providers,
  exports: [PrismaService, AdminConfigService],
})
export class AdminModule {}
