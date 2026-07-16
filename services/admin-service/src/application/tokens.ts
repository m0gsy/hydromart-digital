export const ADMIN_TOKENS = {
  FeatureFlagRepository: Symbol('FeatureFlagRepository'),
  SystemSettingsRepository: Symbol('SystemSettingsRepository'),
  HealthProbe: Symbol('HealthProbe'),
  ApiKeyRepository: Symbol('ApiKeyRepository'),
  WebhookRepository: Symbol('WebhookRepository'),
  ExportLogRepository: Symbol('ExportLogRepository'),
  ScheduledReportRepository: Symbol('ScheduledReportRepository'),
} as const;
