import { DomainError, HTTP_STATUS } from '@hydromart/platform';

export class FeatureFlagNotFoundError extends DomainError {
  readonly code = 'FEATURE_FLAG_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(key: string) {
    super(`Feature flag "${key}" not found.`);
  }
}

export class ApiKeyNotFoundError extends DomainError {
  readonly code = 'API_KEY_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`API key "${id}" not found.`);
  }
}

export class WebhookNotFoundError extends DomainError {
  readonly code = 'WEBHOOK_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`Webhook endpoint "${id}" not found.`);
  }
}

export class ScheduledReportNotFoundError extends DomainError {
  readonly code = 'SCHEDULED_REPORT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`Scheduled report "${id}" not found.`);
  }
}

export class SupportTicketNotFoundError extends DomainError {
  readonly code = 'SUPPORT_TICKET_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`Support ticket "${id}" not found.`);
  }
}

export class FraudFlagNotFoundError extends DomainError {
  readonly code = 'FRAUD_FLAG_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`Fraud flag "${id}" not found.`);
  }
}

export class IncidentNotFoundError extends DomainError {
  readonly code = 'INCIDENT_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`Incident "${id}" not found.`);
  }
}

export class RetentionPolicyNotFoundError extends DomainError {
  readonly code = 'RETENTION_POLICY_NOT_FOUND';
  readonly status = HTTP_STATUS.NOT_FOUND;
  constructor(id: string) {
    super(`Retention policy "${id}" not found.`);
  }
}
