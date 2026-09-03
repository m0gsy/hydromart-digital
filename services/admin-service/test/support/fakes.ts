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
import {
  ListSupportTicketsFilter,
  CreateSupportTicketData,
  SupportTicketRecord,
  SupportTicketRepository,
} from '../../src/application/ports/support-ticket.repository';
import {
  CreateFraudFlagData,
  FraudFlagRecord,
  FraudFlagRepository,
  ListFraudFlagsFilter,
} from '../../src/application/ports/fraud-flag.repository';
import {
  CreateIncidentData,
  IncidentRecord,
  IncidentRepository,
  ListIncidentsFilter,
  PatchIncidentData,
} from '../../src/application/ports/incident.repository';
import { ApiKeyEnvironment } from '../../src/domain/api-key-environment';
import { DataClass, isPurgeExempt } from '../../src/domain/retention';
import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { ReportDataset } from '../../src/domain/report-dataset';
import { ReportCadence } from '../../src/domain/report-cadence';
import { TicketAuthorType, TicketPriority, TicketStatus } from '../../src/domain/ticket';
import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { IncidentSeverity, IncidentStatus } from '../../src/domain/incident';

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
    return [...this.flags].sort((a, b) => a.key.localeCompare(b.key)).map((f) => ({ ...f }));
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
  /** id → stored hash. Kept beside the records because a record never exposes its hash. */
  hashes = new Map<string, string>();

  async list(): Promise<ApiKeyRecord[]> {
    return this.keys.map((k) => ({ ...k }));
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const id = [...this.hashes.entries()].find(([, h]) => h === keyHash)?.[0];
    const found = this.keys.find((k) => k.id === id);
    return found ? { ...found } : null;
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    const k = this.keys.find((x) => x.id === id);
    if (k) k.lastUsedAt = at;
  }

  async create(data: CreateApiKeyData): Promise<ApiKeyRecord> {
    // The hash is intentionally dropped from the record — records never expose it.
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
    this.hashes.set(record.id, data.keyHash);
    return { ...record };
  }

  async rotate(id: string, keyPrefix: string, keyHash: string): Promise<ApiKeyRecord | null> {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return null;
    k.keyPrefix = keyPrefix;
    k.revokedAt = null;
    this.hashes.set(k.id, keyHash);
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
      apiKeyId: data.apiKeyId ?? null,
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
  /** The stored bytes, kept beside the rows the way the column sits beside them. */
  files = new Map<string, { fileName: string; content: Buffer }>();

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
      fileName: data.fileName ?? null,
      hasFile: data.content != null && data.fileName != null,
      createdAt: nextDate(),
    };
    this.rows.push(record);
    if (data.content && data.fileName) {
      this.files.set(record.id, { fileName: data.fileName, content: data.content });
    }
    return { ...record };
  }

  async findContent(id: string): Promise<{ fileName: string; content: Buffer } | null> {
    return this.files.get(id) ?? null;
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
    fileName: null,
    hasFile: false,
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
      dataset: data.dataset ?? ReportDataset.REVENUE_BY_DEPOT,
      // CA-2-66: null is "never run" — the same thing a null lastRunAt has always meant.
      lastRunOk: null,
      lastError: null,
      nextRunAt: data.nextRunAt ?? null,
      lastRunAt: null,
      enabled: data.enabled ?? true,
      createdAt: nextDate(),
    };
    this.reports.push(record);
    return { ...record };
  }

  async findDue(now: Date, limit: number): Promise<ScheduledReportRecord[]> {
    return this.reports
      .filter((r) => r.enabled && (r.nextRunAt === null || r.nextRunAt <= now))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async update(id: string, data: UpdateScheduledReportData): Promise<ScheduledReportRecord | null> {
    const r = this.reports.find((x) => x.id === id);
    if (!r) return null;
    if (data.name !== undefined) r.name = data.name;
    if (data.cadence !== undefined) r.cadence = data.cadence;
    if (data.recipients !== undefined) r.recipients = data.recipients;
    if (data.format !== undefined) r.format = data.format;
    if (data.dataset !== undefined) r.dataset = data.dataset;
    if (data.nextRunAt !== undefined) r.nextRunAt = data.nextRunAt;
    if (data.lastRunAt !== undefined) r.lastRunAt = data.lastRunAt;
    if (data.lastRunOk !== undefined) r.lastRunOk = data.lastRunOk;
    if (data.lastError !== undefined) r.lastError = data.lastError;
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
    lastRunOk: null,
    lastError: null,
    format: ExportFormat.XLSX,
    dataset: ReportDataset.REVENUE_BY_DEPOT,
    nextRunAt: null,
    lastRunAt: null,
    enabled: true,
    createdAt: nextDate(),
    ...over,
  };
}

export function makeSupportTicket(over: Partial<SupportTicketRecord> = {}): SupportTicketRecord {
  return {
    id: randomUUID(),
    subject: 'Sample ticket',
    customerRef: 'Ibu Rina',
    customerPhone: '0812-0000-0001',
    orderRef: 'ORD-0231',
    customerId: null,
    priority: TicketPriority.MEDIUM,
    status: TicketStatus.OPEN,
    assigneeId: null,
    createdAt: nextDate(),
    messages: [],
    ...over,
  };
}

export class InMemorySupportTicketRepository implements SupportTicketRepository {
  rows: SupportTicketRecord[] = [];

  /**
   * PDP erasure. Matches on id OR phone — a ticket staff opened at the counter has a phone
   * and no id. The customer's own messages are blanked; staff replies stay.
   */
  async erasePerson(customerId: string, phone: string | null): Promise<number> {
    const mine = this.rows.filter(
      (r) => r.customerId === customerId || (phone !== null && r.customerPhone === phone),
    );
    for (const row of mine) {
      row.customerRef = 'Pengguna dihapus';
      row.customerPhone = '-';
      for (const m of row.messages ?? []) {
        if (m.authorType === 'CUSTOMER') m.body = '[dihapus atas permintaan pemilik data]';
      }
    }
    return mine.length;
  }

  /** K1.5: scoped by customerId and nothing else — never by phone number. */
  async listForCustomer(customerId: string, limit: number): Promise<SupportTicketRecord[]> {
    return this.rows
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async create(data: CreateSupportTicketData): Promise<SupportTicketRecord> {
    const id = randomUUID();
    const row: SupportTicketRecord = {
      id,
      subject: data.subject,
      customerRef: data.customerRef,
      customerPhone: data.customerPhone,
      orderRef: data.orderRef ?? null,
      customerId: data.customerId ?? null,
      priority: data.priority ?? TicketPriority.MEDIUM,
      status: TicketStatus.OPEN,
      assigneeId: null,
      createdAt: nextDate(),
      messages: [
        {
          id: randomUUID(),
          ticketId: id,
          authorType: TicketAuthorType.CUSTOMER,
          body: data.body,
          createdAt: nextDate(),
        },
      ],
    };
    this.rows.push(row);
    return { ...row, messages: [...row.messages] };
  }

  async list(filter: ListSupportTicketsFilter): Promise<SupportTicketRecord[]> {
    let items = [...this.rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (filter.status) items = items.filter((r) => r.status === filter.status);
    if (filter.priority) items = items.filter((r) => r.priority === filter.priority);
    return items.map((r) => ({ ...r, messages: [...r.messages] }));
  }

  async findById(id: string): Promise<SupportTicketRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r, messages: [...r.messages] } : null;
  }

  async addStaffMessage(id: string, body: string): Promise<SupportTicketRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.messages.push({
      id: randomUUID(),
      ticketId: id,
      authorType: TicketAuthorType.STAFF,
      body,
      createdAt: nextDate(),
    });
    return { ...r, messages: [...r.messages] };
  }

  async assign(id: string, assigneeId: string): Promise<SupportTicketRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.assigneeId = assigneeId;
    r.status = TicketStatus.ASSIGNED;
    return { ...r, messages: [...r.messages] };
  }

  async resolve(id: string): Promise<SupportTicketRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.status = TicketStatus.RESOLVED;
    return { ...r, messages: [...r.messages] };
  }
}

export function makeFraudFlag(over: Partial<FraudFlagRecord> = {}): FraudFlagRecord {
  return {
    id: randomUUID(),
    entityType: FraudEntityType.ORDER,
    entityRef: 'ORD-0261',
    score: 80,
    level: FraudLevel.HIGH,
    signals: ['Sample signal'],
    status: FraudStatus.OPEN,
    createdAt: nextDate(),
    ...over,
  };
}

export class InMemoryFraudFlagRepository implements FraudFlagRepository {
  rows: FraudFlagRecord[] = [];

  async list(filter: ListFraudFlagsFilter): Promise<FraudFlagRecord[]> {
    let items = [...this.rows].sort(
      (a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime(),
    );
    if (filter.level) items = items.filter((r) => r.level === filter.level);
    if (filter.status) items = items.filter((r) => r.status === filter.status);
    return items.map((r) => ({ ...r }));
  }

  async create(data: CreateFraudFlagData): Promise<FraudFlagRecord> {
    const record: FraudFlagRecord = {
      id: randomUUID(),
      entityType: data.entityType,
      entityRef: data.entityRef,
      score: data.score,
      level: data.level,
      signals: data.signals,
      status: data.status ?? FraudStatus.OPEN,
      createdAt: nextDate(),
    };
    this.rows.push(record);
    return { ...record };
  }

  async setStatus(id: string, status: FraudStatus): Promise<FraudFlagRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.status = status;
    return { ...r };
  }
}

export function makeIncident(over: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: randomUUID(),
    title: 'Sample incident',
    severity: IncidentSeverity.WARNING,
    affectedService: 'order-service',
    status: IncidentStatus.ONGOING,
    startedAt: nextDate(),
    resolvedAt: null,
    note: null,
    updates: [],
    ...over,
  };
}

export class InMemoryIncidentRepository implements IncidentRepository {
  rows: IncidentRecord[] = [];

  async list(filter: ListIncidentsFilter): Promise<IncidentRecord[]> {
    let items = [...this.rows].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    if (filter.status) items = items.filter((r) => r.status === filter.status);
    return items.map((r) => ({ ...r, updates: [...r.updates] }));
  }

  async create(data: CreateIncidentData): Promise<IncidentRecord> {
    const record: IncidentRecord = {
      id: randomUUID(),
      title: data.title,
      severity: data.severity,
      affectedService: data.affectedService,
      status: IncidentStatus.ONGOING,
      startedAt: nextDate(),
      resolvedAt: null,
      note: data.note ?? null,
      updates: [],
    };
    this.rows.push(record);
    return { ...record, updates: [] };
  }

  async patch(id: string, data: PatchIncidentData): Promise<IncidentRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    if (data.note) {
      r.updates.unshift({
        id: randomUUID(),
        incidentId: id,
        note: data.note,
        createdAt: nextDate(),
      });
    }
    if (data.status) {
      r.status = data.status;
      r.resolvedAt = data.status === IncidentStatus.RESOLVED ? nextDate() : null;
    }
    return { ...r, updates: [...r.updates] };
  }
}

import {
  SaveSlaPolicyData,
  SlaPolicyRecord,
  SlaPolicyRepository,
} from '../../src/application/ports/sla-policy.repository';
import {
  BackupStatusRecord,
  RecordBackupRunData,
  RetentionPolicyRecord,
  RetentionRepository,
  UpdateRetentionData,
} from '../../src/application/ports/retention.repository';
import {
  SaveSecurityPolicyData,
  SecurityPolicyRecord,
  SecurityPolicyRepository,
} from '../../src/application/ports/security-policy.repository';
import {
  AdminNotificationPrefRecord,
  AdminNotificationPrefRepository,
  NotificationChannelPref,
} from '../../src/application/ports/admin-notification-pref.repository';
import {
  OnboardingStateRecord,
  OnboardingStateRepository,
  OnboardingStep,
} from '../../src/application/ports/onboarding-state.repository';

export class InMemorySlaPolicyRepository implements SlaPolicyRepository {
  row: SlaPolicyRecord | null = null;

  async get(): Promise<SlaPolicyRecord | null> {
    return this.row ? { ...this.row } : null;
  }

  async save(data: SaveSlaPolicyData): Promise<SlaPolicyRecord> {
    this.row = { ...data, updatedAt: nextDate() };
    return { ...this.row };
  }
}

export function makeRetentionPolicy(
  over: Partial<RetentionPolicyRecord> = {},
): RetentionPolicyRecord {
  const dataClass = over.dataClass ?? DataClass.OPERATIONAL;
  return {
    id: randomUUID(),
    dataset: 'proof_of_delivery',
    windowLabel: '1 tahun',
    windowDays: 365,
    updatedAt: nextDate(),
    ...over,
    dataClass,
    // Derived, exactly as the real repository derives it.
    purgeExempt: isPurgeExempt(dataClass),
  };
}

export class InMemoryRetentionRepository implements RetentionRepository {
  rows: RetentionPolicyRecord[] = [];
  backup: BackupStatusRecord | null = null;

  async listPolicies(): Promise<RetentionPolicyRecord[]> {
    return [...this.rows].sort((a, b) => a.dataset.localeCompare(b.dataset)).map((r) => ({ ...r }));
  }

  async findPolicy(id: string): Promise<RetentionPolicyRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }

  async updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    r.windowLabel = data.windowLabel;
    r.windowDays = data.windowDays;
    if (data.dataClass) {
      r.dataClass = data.dataClass;
      r.purgeExempt = isPurgeExempt(data.dataClass);
    }
    r.updatedAt = nextDate();
    return { ...r };
  }

  async getBackupStatus(): Promise<BackupStatusRecord | null> {
    return this.backup ? { ...this.backup } : null;
  }

  /**
   * Models the real upsert's partial write: a drill result must not blank last night's
   * backup verdict, and vice versa. A fake that overwrote the whole row would let that
   * bug through the test suite.
   */
  async recordBackupRun(data: RecordBackupRunData): Promise<BackupStatusRecord> {
    const base: BackupStatusRecord = this.backup ?? {
      status: 'NONE',
      lastBackupAt: null,
      detail: null,
      drillStatus: 'NONE',
      lastDrillAt: null,
      drillDetail: null,
    };
    this.backup =
      data.kind === 'BACKUP'
        ? { ...base, status: data.status, lastBackupAt: data.at, detail: data.detail }
        : { ...base, drillStatus: data.status, lastDrillAt: data.at, drillDetail: data.detail };
    return { ...this.backup };
  }
}

export class InMemorySecurityPolicyRepository implements SecurityPolicyRepository {
  row: SecurityPolicyRecord | null = null;

  async get(): Promise<SecurityPolicyRecord | null> {
    return this.row ? { ...this.row } : null;
  }

  async save(data: SaveSecurityPolicyData): Promise<SecurityPolicyRecord> {
    this.row = { ...data, ipAllowlist: [...data.ipAllowlist], updatedAt: nextDate() };
    return { ...this.row, ipAllowlist: [...this.row.ipAllowlist] };
  }
}

export class InMemoryAdminNotificationPrefRepository implements AdminNotificationPrefRepository {
  rows = new Map<string, AdminNotificationPrefRecord>();

  async get(accountId: string): Promise<AdminNotificationPrefRecord | null> {
    const r = this.rows.get(accountId);
    return r ? { ...r, channels: r.channels.map((c) => ({ ...c })) } : null;
  }

  async save(
    accountId: string,
    channels: NotificationChannelPref[],
  ): Promise<AdminNotificationPrefRecord> {
    const record: AdminNotificationPrefRecord = {
      accountId,
      channels: channels.map((c) => ({ ...c })),
      updatedAt: nextDate(),
    };
    this.rows.set(accountId, record);
    return { ...record, channels: record.channels.map((c) => ({ ...c })) };
  }
}

export class InMemoryOnboardingStateRepository implements OnboardingStateRepository {
  row: OnboardingStateRecord | null = null;

  async get(): Promise<OnboardingStateRecord | null> {
    return this.row ? { ...this.row } : null;
  }

  async setStep(step: OnboardingStep, done: boolean): Promise<OnboardingStateRecord> {
    this.row = {
      verify2fa: false,
      addDepot: false,
      inviteHeadOffice: false,
      setPricingTax: false,
      enablePayments: false,
      ...this.row,
      [step]: done,
      updatedAt: nextDate(),
    };
    return { ...this.row };
  }
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
