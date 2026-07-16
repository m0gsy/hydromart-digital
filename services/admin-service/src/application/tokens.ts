export const ADMIN_TOKENS = {
  FeatureFlagRepository: Symbol('FeatureFlagRepository'),
  SystemSettingsRepository: Symbol('SystemSettingsRepository'),
  HealthProbe: Symbol('HealthProbe'),
  ApiKeyRepository: Symbol('ApiKeyRepository'),
  WebhookRepository: Symbol('WebhookRepository'),
  ExportLogRepository: Symbol('ExportLogRepository'),
  ScheduledReportRepository: Symbol('ScheduledReportRepository'),
  SupportTicketRepository: Symbol('SupportTicketRepository'),
  FraudFlagRepository: Symbol('FraudFlagRepository'),
  IncidentRepository: Symbol('IncidentRepository'),
} as const;
