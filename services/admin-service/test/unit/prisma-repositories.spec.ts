import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

import { AdminNotificationPrefPrismaRepository } from '../../src/infrastructure/prisma/admin-notification-pref.prisma.repository';
import { ApiKeyPrismaRepository } from '../../src/infrastructure/prisma/api-key.prisma.repository';
import { ExportLogPrismaRepository } from '../../src/infrastructure/prisma/export-log.prisma.repository';
import { FeatureFlagPrismaRepository } from '../../src/infrastructure/prisma/feature-flag.prisma.repository';
import { FraudFlagPrismaRepository } from '../../src/infrastructure/prisma/fraud-flag.prisma.repository';
import { IncidentPrismaRepository } from '../../src/infrastructure/prisma/incident.prisma.repository';
import { OnboardingStatePrismaRepository } from '../../src/infrastructure/prisma/onboarding-state.prisma.repository';
import { RetentionPrismaRepository } from '../../src/infrastructure/prisma/retention.prisma.repository';
import { ScheduledReportPrismaRepository } from '../../src/infrastructure/prisma/scheduled-report.prisma.repository';
import { SecurityPolicyPrismaRepository } from '../../src/infrastructure/prisma/security-policy.prisma.repository';
import { SlaPolicyPrismaRepository } from '../../src/infrastructure/prisma/sla-policy.prisma.repository';
import { SupportTicketPrismaRepository } from '../../src/infrastructure/prisma/support-ticket.prisma.repository';
import { SystemSettingsPrismaRepository } from '../../src/infrastructure/prisma/system-settings.prisma.repository';
import { WebhookPrismaRepository } from '../../src/infrastructure/prisma/webhook.prisma.repository';

import { ApiKeyEnvironment } from '../../src/domain/api-key-environment';
import { FlagState } from '../../src/domain/flag-state';
import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { IncidentSeverity, IncidentStatus } from '../../src/domain/incident';
import { ReportCadence } from '../../src/domain/report-cadence';
import { TicketAuthorType, TicketPriority, TicketStatus } from '../../src/domain/ticket';

const now = new Date('2026-07-19T00:00:00.000Z');

describe('AdminNotificationPrefPrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { adminNotificationPref: model } as unknown as PrismaService;
  const repo = new AdminNotificationPrefPrismaRepository(prisma);
  const channels = [{ id: 'order.new', push: true, email: false, wa: true }];

  beforeEach(() => jest.clearAllMocks());

  it('get maps a persisted row', async () => {
    model.findUnique.mockResolvedValue({ accountId: 'acc-1', channels, updatedAt: now });
    const rec = await repo.get('acc-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { accountId: 'acc-1' } });
    expect(rec).toEqual({ accountId: 'acc-1', channels, updatedAt: now });
  });

  it('get returns null when the account has no prefs', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.get('acc-x')).toBeNull();
  });

  it('save upserts with create+update payloads and maps the row back', async () => {
    model.upsert.mockResolvedValue({ accountId: 'acc-1', channels, updatedAt: now });
    const rec = await repo.save('acc-1', channels);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { accountId: 'acc-1' },
      update: { channels },
      create: { accountId: 'acc-1', channels },
    });
    expect(rec.channels).toEqual(channels);
  });
});

describe('ApiKeyPrismaRepository', () => {
  const model = { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const prisma = { apiKey: model } as unknown as PrismaService;
  const repo = new ApiKeyPrismaRepository(prisma);
  const row = () => ({
    id: 'key-1',
    name: 'CI',
    keyPrefix: 'hm_live_ab',
    scopes: ['read'],
    environment: 'PROD',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
  });
  const SELECT = {
    id: true,
    name: true,
    keyPrefix: true,
    scopes: true,
    environment: true,
    lastUsedAt: true,
    revokedAt: true,
    createdAt: true,
  };

  beforeEach(() => jest.clearAllMocks());

  it('list selects safe columns, orders newest-first and casts environment', async () => {
    model.findMany.mockResolvedValue([row()]);
    const recs = await repo.list();
    expect(model.findMany).toHaveBeenCalledWith({ select: SELECT, orderBy: { createdAt: 'desc' } });
    expect(recs[0].environment).toBe(ApiKeyEnvironment.PROD);
  });

  it('create persists data with the safe select', async () => {
    model.create.mockResolvedValue(row());
    const data = {
      name: 'CI',
      keyPrefix: 'hm_live_ab',
      keyHash: 'secret-hash',
      scopes: ['read'],
      environment: ApiKeyEnvironment.PROD,
    };
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data, select: SELECT });
  });

  it('rotate updates prefix/hash and clears revokedAt when the key exists', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue(row());
    const rec = await repo.rotate('key-1', 'hm_live_cd', 'new-hash');
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { keyPrefix: 'hm_live_cd', keyHash: 'new-hash', revokedAt: null },
      select: SELECT,
    });
    expect(rec?.id).toBe('key-1');
  });

  it('rotate returns null and does not update an unknown key', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.rotate('nope', 'p', 'h')).toBeNull();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('revoke stamps revokedAt when the key exists', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue(row());
    await repo.revoke('key-1');
    expect(model.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'key-1' }, select: SELECT }),
    );
    expect(model.update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
  });

  it('revoke returns null for an unknown key', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.revoke('nope')).toBeNull();
    expect(model.update).not.toHaveBeenCalled();
  });
});

describe('ExportLogPrismaRepository', () => {
  const model = { findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  const prisma = { exportLog: model } as unknown as PrismaService;
  const repo = new ExportLogPrismaRepository(prisma);
  const row = () => ({
    id: 'exp-1',
    dataset: 'orders',
    requestedById: 'u-1',
    requestedByEmail: 'ops@x.com',
    format: 'CSV',
    rowCount: 10,
    status: 'DONE',
    createdAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('list applies filters, paginates and returns a mapped page', async () => {
    model.findMany.mockResolvedValue([row()]);
    model.count.mockResolvedValue(1);
    const page = await repo.list({ page: 2, limit: 20, dataset: 'orders', status: ExportStatus.DONE });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { dataset: 'orders', status: ExportStatus.DONE },
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 20,
    });
    expect(model.count).toHaveBeenCalledWith({ where: { dataset: 'orders', status: ExportStatus.DONE } });
    expect(page).toEqual({
      items: [expect.objectContaining({ format: ExportFormat.CSV, status: ExportStatus.DONE })],
      total: 1,
      page: 2,
      limit: 20,
    });
  });

  it('list omits filter keys when not supplied', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.list({ page: 1, limit: 10 });
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 10 }),
    );
  });

  it('create persists and maps the row', async () => {
    model.create.mockResolvedValue(row());
    const data = { dataset: 'orders', requestedByEmail: 'ops@x.com', format: ExportFormat.CSV };
    const rec = await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
    expect(rec.status).toBe(ExportStatus.DONE);
  });
});

describe('FeatureFlagPrismaRepository', () => {
  const model = { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const prisma = { featureFlag: model } as unknown as PrismaService;
  const repo = new FeatureFlagPrismaRepository(prisma);
  const row = () => ({
    id: 'f-1',
    key: 'new-checkout',
    label: 'New checkout',
    description: 'desc',
    state: 'ACTIVE',
    rolloutPct: null,
    createdAt: now,
    updatedAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('list orders by key asc and casts state', async () => {
    model.findMany.mockResolvedValue([row()]);
    const recs = await repo.list();
    expect(model.findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
    expect(recs[0].state).toBe(FlagState.ACTIVE);
  });

  it('findByKey returns a mapped record or null', async () => {
    model.findUnique.mockResolvedValueOnce(row());
    expect((await repo.findByKey('new-checkout'))?.state).toBe(FlagState.ACTIVE);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { key: 'new-checkout' } });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByKey('missing')).toBeNull();
  });

  it('update guards existence then patches', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue({ ...row(), state: 'OFF' });
    const rec = await repo.update('new-checkout', { state: FlagState.OFF });
    expect(model.update).toHaveBeenCalledWith({
      where: { key: 'new-checkout' },
      data: { state: FlagState.OFF },
    });
    expect(rec?.state).toBe(FlagState.OFF);
  });

  it('update returns null for an unknown key', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.update('nope', { state: FlagState.OFF })).toBeNull();
    expect(model.update).not.toHaveBeenCalled();
  });
});

describe('FraudFlagPrismaRepository', () => {
  const model = { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const prisma = { fraudFlag: model } as unknown as PrismaService;
  const repo = new FraudFlagPrismaRepository(prisma);
  const row = () => ({
    id: 'fr-1',
    entityType: 'ORDER',
    entityRef: 'ord-1',
    score: 88,
    level: 'HIGH',
    signals: ['velocity'],
    status: 'OPEN',
    createdAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('list filters and orders by score-then-newest', async () => {
    model.findMany.mockResolvedValue([row()]);
    const recs = await repo.list({ level: FraudLevel.HIGH, status: FraudStatus.OPEN });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { level: FraudLevel.HIGH, status: FraudStatus.OPEN },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
    expect(recs[0].entityType).toBe(FraudEntityType.ORDER);
    expect(recs[0].level).toBe(FraudLevel.HIGH);
  });

  it('list uses an empty where when unfiltered', async () => {
    model.findMany.mockResolvedValue([]);
    await repo.list({});
    expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('create persists and maps', async () => {
    model.create.mockResolvedValue(row());
    const data = {
      entityType: FraudEntityType.ORDER,
      entityRef: 'ord-1',
      score: 88,
      level: FraudLevel.HIGH,
      signals: ['velocity'],
    };
    const rec = await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
    expect(rec.status).toBe(FraudStatus.OPEN);
  });

  it('setStatus guards existence then updates', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue({ ...row(), status: 'CLEARED' });
    const rec = await repo.setStatus('fr-1', FraudStatus.CLEARED);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'fr-1' }, data: { status: FraudStatus.CLEARED } });
    expect(rec?.status).toBe(FraudStatus.CLEARED);
  });

  it('setStatus returns null for an unknown flag', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.setStatus('nope', FraudStatus.CLEARED)).toBeNull();
    expect(model.update).not.toHaveBeenCalled();
  });
});

describe('IncidentPrismaRepository', () => {
  const incident = {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const incidentUpdate = { create: jest.fn() };
  const prisma = { incident, incidentUpdate } as unknown as PrismaService;
  const repo = new IncidentPrismaRepository(prisma);
  const row = () => ({
    id: 'inc-1',
    title: 'DB latency',
    severity: 'CRITICAL',
    affectedService: 'order-service',
    status: 'ONGOING',
    startedAt: now,
    resolvedAt: null,
    note: null,
    updates: [{ id: 'u-1', incidentId: 'inc-1', note: 'looking', createdAt: now }],
  });

  beforeEach(() => jest.clearAllMocks());

  it('list filters by status, orders newest-first and includes updates', async () => {
    incident.findMany.mockResolvedValue([row()]);
    const recs = await repo.list({ status: IncidentStatus.ONGOING });
    expect(incident.findMany).toHaveBeenCalledWith({
      where: { status: IncidentStatus.ONGOING },
      orderBy: { startedAt: 'desc' },
      include: { updates: { orderBy: { createdAt: 'desc' } } },
    });
    expect(recs[0].severity).toBe(IncidentSeverity.CRITICAL);
    expect(recs[0].updates).toHaveLength(1);
  });

  it('list uses an empty where when unfiltered', async () => {
    incident.findMany.mockResolvedValue([]);
    await repo.list({});
    expect(incident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('create maps optional note to null', async () => {
    incident.create.mockResolvedValue(row());
    await repo.create({ title: 'DB latency', severity: IncidentSeverity.CRITICAL, affectedService: 'order-service' });
    expect(incident.create).toHaveBeenCalledWith({
      data: { title: 'DB latency', severity: IncidentSeverity.CRITICAL, affectedService: 'order-service', note: null },
      include: { updates: { orderBy: { createdAt: 'desc' } } },
    });
  });

  it('patch appends a note and moves status to RESOLVED with a resolvedAt', async () => {
    incident.findUnique.mockResolvedValueOnce(row());
    incident.findUnique.mockResolvedValueOnce({ ...row(), status: 'RESOLVED', resolvedAt: now });
    await repo.patch('inc-1', { note: 'fixed', status: IncidentStatus.RESOLVED });
    expect(incidentUpdate.create).toHaveBeenCalledWith({ data: { incidentId: 'inc-1', note: 'fixed' } });
    const updateArg = incident.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'inc-1' });
    expect(updateArg.data.status).toBe(IncidentStatus.RESOLVED);
    expect(updateArg.data.resolvedAt).toBeInstanceOf(Date);
  });

  it('patch clears resolvedAt when moving to a non-resolved status and skips note create when absent', async () => {
    incident.findUnique.mockResolvedValueOnce(row());
    incident.findUnique.mockResolvedValueOnce(row());
    await repo.patch('inc-1', { status: IncidentStatus.ONGOING });
    expect(incidentUpdate.create).not.toHaveBeenCalled();
    expect(incident.update.mock.calls[0][0].data.resolvedAt).toBeNull();
  });

  it('patch returns null for an unknown incident', async () => {
    incident.findUnique.mockResolvedValue(null);
    expect(await repo.patch('nope', { note: 'x' })).toBeNull();
    expect(incident.update).not.toHaveBeenCalled();
    expect(incidentUpdate.create).not.toHaveBeenCalled();
  });
});

describe('OnboardingStatePrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { onboardingState: model } as unknown as PrismaService;
  const repo = new OnboardingStatePrismaRepository(prisma);
  const row = () => ({
    verify2fa: true,
    addDepot: false,
    inviteHeadOffice: false,
    setPricingTax: false,
    enablePayments: false,
    updatedAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('get reads the singleton and strips the id', async () => {
    model.findUnique.mockResolvedValue({ id: 'singleton', ...row() });
    const rec = await repo.get();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } });
    expect(rec).toEqual(row());
  });

  it('get returns null before any step is written', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.get()).toBeNull();
  });

  it('setStep upserts the singleton keyed on the step', async () => {
    model.upsert.mockResolvedValue(row());
    await repo.setStep('addDepot', true);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      update: { addDepot: true },
      create: { id: 'singleton', addDepot: true },
    });
  });
});

describe('RetentionPrismaRepository', () => {
  const retentionPolicy = { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const backupStatus = { findUnique: jest.fn() };
  const prisma = { retentionPolicy, backupStatus } as unknown as PrismaService;
  const repo = new RetentionPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('listPolicies orders by dataset', async () => {
    retentionPolicy.findMany.mockResolvedValue([{ id: 'r-1' }]);
    await repo.listPolicies();
    expect(retentionPolicy.findMany).toHaveBeenCalledWith({ orderBy: { dataset: 'asc' } });
  });

  it('updatePolicy guards existence then updates', async () => {
    retentionPolicy.findUnique.mockResolvedValue({ id: 'r-1' });
    retentionPolicy.update.mockResolvedValue({ id: 'r-1' });
    const data = { windowLabel: '30 days', windowDays: 30 };
    await repo.updatePolicy('r-1', data);
    expect(retentionPolicy.update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data });
  });

  it('updatePolicy returns null for an unknown id', async () => {
    retentionPolicy.findUnique.mockResolvedValue(null);
    expect(await repo.updatePolicy('nope', { windowLabel: 'x', windowDays: 1 })).toBeNull();
    expect(retentionPolicy.update).not.toHaveBeenCalled();
  });

  it('getBackupStatus maps the singleton or returns null', async () => {
    backupStatus.findUnique.mockResolvedValueOnce({ status: 'OK', lastBackupAt: now });
    expect(await repo.getBackupStatus()).toEqual({ status: 'OK', lastBackupAt: now });
    expect(backupStatus.findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } });
    backupStatus.findUnique.mockResolvedValueOnce(null);
    expect(await repo.getBackupStatus()).toBeNull();
  });
});

describe('ScheduledReportPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { scheduledReport: model } as unknown as PrismaService;
  const repo = new ScheduledReportPrismaRepository(prisma);
  const row = () => ({
    id: 'sr-1',
    name: 'Weekly ops',
    cadence: 'WEEKLY',
    recipients: ['ops@x.com'],
    format: 'PDF',
    nextRunAt: now,
    enabled: true,
    createdAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('list orders newest-first and casts enums', async () => {
    model.findMany.mockResolvedValue([row()]);
    const recs = await repo.list();
    expect(model.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    expect(recs[0].cadence).toBe(ReportCadence.WEEKLY);
    expect(recs[0].format).toBe(ExportFormat.PDF);
  });

  it('create persists and maps', async () => {
    model.create.mockResolvedValue(row());
    const data = { name: 'Weekly ops', cadence: ReportCadence.WEEKLY, recipients: ['ops@x.com'] };
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('update guards existence then patches', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue({ ...row(), enabled: false });
    const rec = await repo.update('sr-1', { enabled: false });
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'sr-1' }, data: { enabled: false } });
    expect(rec?.enabled).toBe(false);
  });

  it('update returns null for an unknown id', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.update('nope', { enabled: false })).toBeNull();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('remove deletes and returns true when present', async () => {
    model.findUnique.mockResolvedValue(row());
    model.delete.mockResolvedValue(row());
    expect(await repo.remove('sr-1')).toBe(true);
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'sr-1' } });
  });

  it('remove returns false for an unknown id', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.remove('nope')).toBe(false);
    expect(model.delete).not.toHaveBeenCalled();
  });
});

describe('SecurityPolicyPrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { securityPolicy: model } as unknown as PrismaService;
  const repo = new SecurityPolicyPrismaRepository(prisma);
  const row = () => ({
    id: 'singleton',
    idleTimeoutMinutes: 30,
    require2fa: true,
    ipAllowlist: ['10.0.0.0/8'],
    updatedAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('get reads the singleton and strips the id', async () => {
    model.findUnique.mockResolvedValue(row());
    expect(await repo.get()).toEqual({
      idleTimeoutMinutes: 30,
      require2fa: true,
      ipAllowlist: ['10.0.0.0/8'],
      updatedAt: now,
    });
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } });
  });

  it('get returns null when never written', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.get()).toBeNull();
  });

  it('save upserts the singleton with full replacement payloads', async () => {
    model.upsert.mockResolvedValue(row());
    const data = { idleTimeoutMinutes: 30, require2fa: true, ipAllowlist: ['10.0.0.0/8'] };
    await repo.save(data);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });
  });
});

describe('SlaPolicyPrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { slaPolicy: model } as unknown as PrismaService;
  const repo = new SlaPolicyPrismaRepository(prisma);
  const row = () => ({
    id: 'singleton',
    onTimeThresholdMinutes: 60,
    healthyBandPct: 90,
    criticalBandPct: 70,
    updatedAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('get reads the singleton and strips the id', async () => {
    model.findUnique.mockResolvedValue(row());
    expect(await repo.get()).toEqual({
      onTimeThresholdMinutes: 60,
      healthyBandPct: 90,
      criticalBandPct: 70,
      updatedAt: now,
    });
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } });
  });

  it('get returns null when never written', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.get()).toBeNull();
  });

  it('save upserts the singleton', async () => {
    model.upsert.mockResolvedValue(row());
    const data = { onTimeThresholdMinutes: 60, healthyBandPct: 90, criticalBandPct: 70 };
    await repo.save(data);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });
  });
});

describe('SupportTicketPrismaRepository', () => {
  const supportTicket = { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const ticketMessage = { create: jest.fn() };
  const prisma = { supportTicket, ticketMessage } as unknown as PrismaService;
  const repo = new SupportTicketPrismaRepository(prisma);
  const row = () => ({
    id: 't-1',
    subject: 'Late delivery',
    customerRef: 'cust-1',
    customerPhone: '+628',
    orderRef: 'ord-1',
    priority: 'HIGH',
    status: 'OPEN',
    assigneeId: null,
    createdAt: now,
    messages: [{ id: 'm-1', ticketId: 't-1', authorType: 'CUSTOMER', body: 'help', createdAt: now }],
  });

  beforeEach(() => jest.clearAllMocks());

  it('list filters, orders newest-first, includes messages asc and casts enums', async () => {
    supportTicket.findMany.mockResolvedValue([row()]);
    const recs = await repo.list({ status: TicketStatus.OPEN, priority: TicketPriority.HIGH });
    expect(supportTicket.findMany).toHaveBeenCalledWith({
      where: { status: TicketStatus.OPEN, priority: TicketPriority.HIGH },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    expect(recs[0].priority).toBe(TicketPriority.HIGH);
    expect(recs[0].messages[0].authorType).toBe(TicketAuthorType.CUSTOMER);
  });

  it('list uses an empty where when unfiltered', async () => {
    supportTicket.findMany.mockResolvedValue([]);
    await repo.list({});
    expect(supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('findById includes messages and maps, or returns null', async () => {
    supportTicket.findUnique.mockResolvedValueOnce(row());
    expect((await repo.findById('t-1'))?.id).toBe('t-1');
    expect(supportTicket.findUnique).toHaveBeenCalledWith({
      where: { id: 't-1' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    supportTicket.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('addStaffMessage appends a STAFF message then re-reads the ticket', async () => {
    supportTicket.findUnique.mockResolvedValueOnce(row()); // existence guard
    supportTicket.findUnique.mockResolvedValueOnce(row()); // findById refresh
    await repo.addStaffMessage('t-1', 'on it');
    expect(ticketMessage.create).toHaveBeenCalledWith({
      data: { ticketId: 't-1', authorType: TicketAuthorType.STAFF, body: 'on it' },
    });
  });

  it('addStaffMessage returns null for an unknown ticket', async () => {
    supportTicket.findUnique.mockResolvedValue(null);
    expect(await repo.addStaffMessage('nope', 'x')).toBeNull();
    expect(ticketMessage.create).not.toHaveBeenCalled();
  });

  it('assign sets assignee and moves to ASSIGNED', async () => {
    supportTicket.findUnique.mockResolvedValueOnce(row());
    supportTicket.findUnique.mockResolvedValueOnce(row());
    await repo.assign('t-1', 'staff-9');
    expect(supportTicket.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { assigneeId: 'staff-9', status: TicketStatus.ASSIGNED },
    });
  });

  it('assign returns null for an unknown ticket', async () => {
    supportTicket.findUnique.mockResolvedValue(null);
    expect(await repo.assign('nope', 's')).toBeNull();
    expect(supportTicket.update).not.toHaveBeenCalled();
  });

  it('resolve moves the ticket to RESOLVED', async () => {
    supportTicket.findUnique.mockResolvedValueOnce(row());
    supportTicket.findUnique.mockResolvedValueOnce(row());
    await repo.resolve('t-1');
    expect(supportTicket.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: TicketStatus.RESOLVED },
    });
  });

  it('resolve returns null for an unknown ticket', async () => {
    supportTicket.findUnique.mockResolvedValue(null);
    expect(await repo.resolve('nope')).toBeNull();
    expect(supportTicket.update).not.toHaveBeenCalled();
  });
});

describe('SystemSettingsPrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { systemSetting: model } as unknown as PrismaService;
  const repo = new SystemSettingsPrismaRepository(prisma);
  const row = () => ({
    id: 'singleton',
    defaultTimezone: 'Asia/Jakarta',
    currency: 'IDR',
    serviceRadiusKm: 8,
    updatedAt: now,
  });

  beforeEach(() => jest.clearAllMocks());

  it('get reads the singleton and strips the id', async () => {
    model.findUnique.mockResolvedValue(row());
    expect(await repo.get()).toEqual({
      defaultTimezone: 'Asia/Jakarta',
      currency: 'IDR',
      serviceRadiusKm: 8,
      updatedAt: now,
    });
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } });
  });

  it('get returns null when never written', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.get()).toBeNull();
  });

  it('save upserts the singleton', async () => {
    model.upsert.mockResolvedValue(row());
    const data = { defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 8 };
    await repo.save(data);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });
  });
});

describe('WebhookPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { webhookEndpoint: model } as unknown as PrismaService;
  const repo = new WebhookPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('list orders newest-first', async () => {
    model.findMany.mockResolvedValue([{ id: 'w-1' }]);
    await repo.list();
    expect(model.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
  });

  it('create passes data straight through', async () => {
    model.create.mockResolvedValue({ id: 'w-1' });
    const data = { url: 'https://x.com/hook', events: ['order.created'] };
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('update guards existence then patches', async () => {
    model.findUnique.mockResolvedValue({ id: 'w-1' });
    model.update.mockResolvedValue({ id: 'w-1' });
    await repo.update('w-1', { active: false });
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'w-1' }, data: { active: false } });
  });

  it('update returns null for an unknown id', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.update('nope', { active: false })).toBeNull();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('remove deletes and returns true when present', async () => {
    model.findUnique.mockResolvedValue({ id: 'w-1' });
    model.delete.mockResolvedValue({ id: 'w-1' });
    expect(await repo.remove('w-1')).toBe(true);
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'w-1' } });
  });

  it('remove returns false for an unknown id', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.remove('nope')).toBe(false);
    expect(model.delete).not.toHaveBeenCalled();
  });
});
