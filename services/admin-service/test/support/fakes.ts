import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { AdminConfigService } from '../../src/config/admin-config.service';
import { FlagState } from '../../src/domain/flag-state';
import {
  FeatureFlagRecord,
  FeatureFlagRepository,
  UpdateFeatureFlagData,
} from '../../src/application/ports/feature-flag.repository';
import {
  SaveSystemSettingsData,
  SystemSettingsRecord,
  SystemSettingsRepository,
} from '../../src/application/ports/system-settings.repository';
import { HealthProbePort, HealthProbeResult } from '../../src/application/ports/health-probe.port';
import {
  ApiKeyRecord,
  ApiKeyRepository,
  CreateApiKeyData,
} from '../../src/application/ports/api-key.repository';
import {
  CreateWebhookData,
  UpdateWebhookData,
  WebhookRecord,
  WebhookRepository,
} from '../../src/application/ports/webhook.repository';
import {
  CreateExportLogData,
  ExportLogPage,
  ExportLogRecord,
  ExportLogRepository,
  ListExportLogsFilter,
} from '../../src/application/ports/export-log.repository';
import {
  CreateScheduledReportData,
  ScheduledReportRecord,
  ScheduledReportRepository,
  UpdateScheduledReportData,
} from '../../src/application/ports/scheduled-report.repository';
import { ApiKeyEnvironment } from '../../src/domain/api-key-environment';
import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { ReportCadence } from '../../src/domain/report-cadence';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export function makeFlag(over: Partial<FeatureFlagRecord> = {}): FeatureFlagRecord {
  const now = nextDate();
  return {
    id: randomUUID(),
    key: 'sample.flag',
    label: 'Sample flag',
    description: 'A sample flag',
    state: FlagState.OFF,
    rolloutPct: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  flags: FeatureFlagRecord[] = [];

  async list(): Promise<FeatureFlagRecord[]> {
    return [...this.flags]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((f) => ({ ...f }));
  }

  async findByKey(key: string): Promise<FeatureFlagRecord | null> {
    const f = this.flags.find((x) => x.key === key);
    return f ? { ...f } : null;
  }

  async update(key: string, data: UpdateFeatureFlagData): Promise<FeatureFlagRecord | null> {
    const f = this.flags.find((x) => x.key === key);
    if (!f) return null;
    if (data.state !== undefined) f.state = data.state;
    if (data.rolloutPct !== undefined) f.rolloutPct = data.rolloutPct;
    f.updatedAt = nextDate();
    return { ...f };
  }
}

export class InMemorySystemSettingsRepository implements SystemSettingsRepository {
  row: SystemSettingsRecord | null = null;

  async get(): Promise<SystemSettingsRecord | null> {
    return this.row ? { ...this.row } : null;
  }

  async save(data: SaveSystemSettingsData): Promise<SystemSettingsRecord> {
    this.row = { ...data, updatedAt: nextDate() };
    return { ...this.row };
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  keys: ApiKeyRecord[] = [];

  async list(): Promise<ApiKeyRecord[]> {
    return this.keys.map((k) => ({ ...k }));
  }

  async create(data: CreateApiKeyData): Promise<ApiKeyRecord> {
    // The hash is intentionally dropped — records never expose it.
    const record: ApiKeyRecord = {
      id: randomUUID(),
      name: data.name,
      keyPrefix: data.keyPrefix,
      scopes: data.scopes,
      environment: data.environment,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: nextDate(),
    };
    this.keys.push(record);
    return { ...record };
  }

  async rotate(id: string, keyPrefix: string, _keyHash: string): Promise<ApiKeyRecord | null> {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return null;
    k.keyPrefix = keyPrefix;
    k.revokedAt = null;
    return { ...k };
  }

  async revoke(id: string): Promise<ApiKeyRecord | null> {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return null;
    k.revokedAt = nextDate();
    return { ...k };
  }
}

export function makeApiKey(over: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: randomUUID(),
    name: 'Sample key',
    keyPrefix: 'hm_live_sample01',
    scopes: ['payments:read'],
    environment: ApiKeyEnvironment.PROD,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: nextDate(),
    ...over,
  };
}

export class InMemoryWebhookRepository implements WebhookRepository {
  hooks: WebhookRecord[] = [];

  async list(): Promise<WebhookRecord[]> {
    return this.hooks.map((h) => ({ ...h }));
  }

  async create(data: CreateWebhookData): Promise<WebhookRecord> {
    const record: WebhookRecord = {
      id: randomUUID(),
      url: data.url,
      events: data.events,
      active: data.active ?? true,
      secret: data.secret ?? null,
      lastDeliveryStatus: null,
      deliveryRatePct: null,
      createdAt: nextDate(),
    };
    this.hooks.push(record);
    return { ...record };
  }

  async update(id: string, data: UpdateWebhookData): Promise<WebhookRecord | null> {
    const h = this.hooks.find((x) => x.id === id);
    if (!h) return null;
    if (data.url !== undefined) h.url = data.url;
    if (data.events !== undefined) h.events = data.events;
    if (data.active !== undefined) h.active = data.active;
    if (data.secret !== undefined) h.secret = data.secret;
    return { ...h };
  }

  async remove(id: string): Promise<boolean> {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter((x) => x.id !== id);
    return this.hooks.length < before;
  }
}

export class InMemoryExportLogRepository implements ExportLogRepository {
  rows: ExportLogRecord[] = [];

  async list(filter: ListExportLogsFilter): Promise<ExportLogPage> {
    let items = [...this.rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (filter.dataset) items = items.filter((r) => r.dataset === filter.dataset);
    if (filter.status) items = items.filter((r) => r.status === filter.status);
    const total = items.length;
    const start = (filter.page - 1) * filter.limit;
    return {
      items: items.slice(start, start + filter.limit).map((r) => ({ ...r })),
      total,
      page: filter.page,
      limit: filter.limit,
    };
  }

  async create(data: CreateExportLogData): Promise<ExportLogRecord> {
    const record: ExportLogRecord = {
      id: randomUUID(),
      dataset: data.dataset,
      requestedById: data.requestedById ?? null,
      requestedByEmail: data.requestedByEmail,
      format: data.format,
      rowCount: data.rowCount ?? null,
      status: data.status ?? ExportStatus.PENDING,
      createdAt: nextDate(),
    };
    this.rows.push(record);
    return { ...record };
  }
}

export function makeExportLog(over: Partial<ExportLogRecord> = {}): ExportLogRecord {
  return {
    id: randomUUID(),
    dataset: 'Sample dataset',
    requestedById: null,
    requestedByEmail: 'ops@hydromart.id',
    format: ExportFormat.CSV,
    rowCount: 10,
    status: ExportStatus.DONE,
    createdAt: nextDate(),
    ...over,
  };
}

export class InMemoryScheduledReportRepository implements ScheduledReportRepository {
  reports: ScheduledReportRecord[] = [];

  async list(): Promise<ScheduledReportRecord[]> {
    return this.reports.map((r) => ({ ...r }));
  }

  async create(data: CreateScheduledReportData): Promise<ScheduledReportRecord> {
    const record: ScheduledReportRecord = {
      id: randomUUID(),
      name: data.name,
      cadence: data.cadence,
      recipients: data.recipients,
      format: data.format ?? ExportFormat.XLSX,
      nextRunAt: data.nextRunAt ?? null,
      enabled: data.enabled ?? true,
      createdAt: nextDate(),
    };
    this.reports.push(record);
    return { ...record };
  }

  async update(id: string, data: UpdateScheduledReportData): Promise<ScheduledReportRecord | null> {
    const r = this.reports.find((x) => x.id === id);
    if (!r) return null;
    if (data.name !== undefined) r.name = data.name;
    if (data.cadence !== undefined) r.cadence = data.cadence;
    if (data.recipients !== undefined) r.recipients = data.recipients;
    if (data.format !== undefined) r.format = data.format;
    if (data.nextRunAt !== undefined) r.nextRunAt = data.nextRunAt;
    if (data.enabled !== undefined) r.enabled = data.enabled;
    return { ...r };
  }

  async remove(id: string): Promise<boolean> {
    const before = this.reports.length;
    this.reports = this.reports.filter((x) => x.id !== id);
    return this.reports.length < before;
  }
}

export function makeScheduledReport(
  over: Partial<ScheduledReportRecord> = {},
): ScheduledReportRecord {
  return {
    id: randomUUID(),
    name: 'Sample report',
    cadence: ReportCadence.DAILY,
    recipients: ['ops@hydromart.id'],
    format: ExportFormat.XLSX,
    nextRunAt: null,
    enabled: true,
    createdAt: nextDate(),
    ...over,
  };
}

export class FakeHealthProbe implements HealthProbePort {
  probed: string[] = [];
  // Map baseUrl -> forced result; anything not present defaults to a healthy probe.
  results = new Map<string, HealthProbeResult>();

  async probe(baseUrl: string): Promise<HealthProbeResult> {
    this.probed.push(baseUrl);
    return this.results.get(baseUrl) ?? { status: 'up', latencyMs: 5, httpStatus: 200 };
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): AdminConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    ADMIN_SERVICE_PORT: '3017',
    ADMIN_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    AUTH_SERVICE_URL: 'http://auth:3001',
    ORDER_SERVICE_URL: 'http://order:3004',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new AdminConfigService(fake as unknown as ConfigService);
}
