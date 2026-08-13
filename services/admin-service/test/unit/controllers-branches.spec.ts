import { AuthenticatedUser } from '@hydromart/platform';

import { ApiKeysController } from '../../src/modules/api-keys.controller';
import { ExportLogsController } from '../../src/modules/export-logs.controller';
import { FraudFlagsController } from '../../src/modules/fraud-flags.controller';
import { IncidentsController } from '../../src/modules/incidents.controller';
import { NotificationPrefsController } from '../../src/modules/notification-prefs.controller';
import { OnboardingController } from '../../src/modules/onboarding.controller';
import { RetentionController } from '../../src/modules/retention.controller';
import { ScheduledReportsController } from '../../src/modules/scheduled-reports.controller';
import { SecurityPolicyController } from '../../src/modules/security-policy.controller';
import { SlaPolicyController } from '../../src/modules/sla-policy.controller';
import { SupportTicketsController } from '../../src/modules/support-tickets.controller';
import { WebhooksController } from '../../src/modules/webhooks.controller';

import { ApiKeyService } from '../../src/application/services/api-key.service';
import { ExportLogService } from '../../src/application/services/export-log.service';
import { FraudFlagService } from '../../src/application/services/fraud-flag.service';
import { IncidentService } from '../../src/application/services/incident.service';
import { AdminNotificationPrefService } from '../../src/application/services/admin-notification-pref.service';
import { OnboardingStateService } from '../../src/application/services/onboarding-state.service';
import { RetentionService } from '../../src/application/services/retention.service';
import { ScheduledReportService } from '../../src/application/services/scheduled-report.service';
import { SecurityPolicyService } from '../../src/application/services/security-policy.service';
import { SlaPolicyService } from '../../src/application/services/sla-policy.service';
import { SupportTicketService } from '../../src/application/services/support-ticket.service';
import { WebhookService } from '../../src/application/services/webhook.service';

import { ApiKeyEnvironment } from '../../src/domain/api-key-environment';
import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { IncidentSeverity, IncidentStatus } from '../../src/domain/incident';
import { ReportCadence } from '../../src/domain/report-cadence';
import { TicketAuthorType, TicketPriority, TicketStatus } from '../../src/domain/ticket';

import { WebhookRecord } from '../../src/application/ports/webhook.repository';
import { BackupStatusRecord } from '../../src/application/ports/retention.repository';
import { SecurityPolicyRecord } from '../../src/application/ports/security-policy.repository';
import { SlaPolicyRecord } from '../../src/application/ports/sla-policy.repository';
import { OnboardingStateRecord } from '../../src/application/ports/onboarding-state.repository';
import { AdminNotificationPrefRecord } from '../../src/application/ports/admin-notification-pref.repository';

import {
  makeApiKey,
  makeExportLog,
  makeFraudFlag,
  makeIncident,
  makeRetentionPolicy,
  makeScheduledReport,
  makeSupportTicket,
} from '../support/fakes';

const now = new Date('2026-07-26T00:00:00.000Z');

// These controllers are thin delegate-and-map shells: each test drives every handler and
// deliberately feeds records with BOTH populated and null date fields so the response DTOs'
// `date ? .toISOString() : null` branches are both exercised.

describe('ApiKeysController', () => {
  const keys = { list: jest.fn(), create: jest.fn(), rotate: jest.fn(), revoke: jest.fn() };
  const controller = new ApiKeysController(keys as unknown as ApiKeyService);
  beforeEach(() => jest.clearAllMocks());

  it('list maps records with populated and null date fields', async () => {
    keys.list.mockResolvedValue([
      makeApiKey({ lastUsedAt: now, revokedAt: now }),
      makeApiKey({ lastUsedAt: null, revokedAt: null }),
    ]);
    const out = await controller.list();
    expect(out).toHaveLength(2);
    expect(out[0].lastUsedAt).toBe(now.toISOString());
    expect(out[1].lastUsedAt).toBeNull();
  });

  it('create defaults the environment to PROD when omitted', async () => {
    keys.create.mockResolvedValue({ record: makeApiKey(), token: 'hm_live_secret' });
    const out = await controller.create({ name: 'CI', scopes: ['read'] });
    expect(keys.create).toHaveBeenCalledWith(
      expect.objectContaining({ environment: ApiKeyEnvironment.PROD }),
    );
    expect(out.token).toBe('hm_live_secret');
  });

  it('create honours an explicit environment', async () => {
    keys.create.mockResolvedValue({ record: makeApiKey(), token: 'hm_test_secret' });
    await controller.create({
      name: 'CI',
      scopes: ['read'],
      environment: ApiKeyEnvironment.STAGING,
    });
    expect(keys.create).toHaveBeenCalledWith(
      expect.objectContaining({ environment: ApiKeyEnvironment.STAGING }),
    );
  });

  it('rotate and revoke delegate by id', async () => {
    keys.rotate.mockResolvedValue({ record: makeApiKey(), token: 'hm_live_new' });
    keys.revoke.mockResolvedValue(makeApiKey({ revokedAt: now }));
    expect((await controller.rotate('k-1')).token).toBe('hm_live_new');
    expect((await controller.revoke('k-1')).revokedAt).toBe(now.toISOString());
  });
});

describe('ExportLogsController', () => {
  const exports = { list: jest.fn(), ingest: jest.fn(), download: jest.fn() };
  const controller = new ExportLogsController(exports as unknown as ExportLogService);
  beforeEach(() => jest.clearAllMocks());

  /*
   * hq/exports was a list of claims — the table recorded exports and never held one. The
   * 404 matters as much as the happy path: a zero-byte spreadsheet is the kind of answer
   * somebody forwards to finance before noticing it says nothing.
   */
  it('download sends the stored file as an attachment', async () => {
    exports.download.mockResolvedValue({ fileName: 'a.csv', content: Buffer.from('hi') });
    const res = { header: jest.fn().mockReturnThis(), send: jest.fn() };
    await controller.download('11111111-1111-4111-8111-111111111111', res as never);
    expect(res.header).toHaveBeenCalledWith('content-type', 'application/octet-stream');
    expect(res.header).toHaveBeenCalledWith(
      'content-disposition',
      'attachment; filename="a.csv"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from('hi'));
  });

  it('download 404s when the row has no file rather than sending an empty body', async () => {
    exports.download.mockResolvedValue(null);
    const res = { header: jest.fn().mockReturnThis(), send: jest.fn() };
    await expect(
      controller.download('11111111-1111-4111-8111-111111111111', res as never),
    ).rejects.toThrow();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('list forwards explicit paging + filters', async () => {
    exports.list.mockResolvedValue({ items: [makeExportLog()], total: 1, page: 2, limit: 5 });
    const out = await controller.list({
      page: 2,
      limit: 5,
      dataset: 'orders',
      status: ExportStatus.DONE,
    });
    expect(exports.list).toHaveBeenCalledWith({
      page: 2,
      limit: 5,
      dataset: 'orders',
      status: ExportStatus.DONE,
    });
    expect(out.items).toHaveLength(1);
  });

  it('list defaults page=1/limit=20 when omitted', async () => {
    exports.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    await controller.list({});
    expect(exports.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, dataset: undefined, status: undefined }),
    );
  });

  it('ingest applies null/PENDING defaults for the optional fields', async () => {
    exports.ingest.mockResolvedValue(makeExportLog());
    await controller.ingest({
      dataset: 'orders',
      requestedByEmail: 'ops@x.com',
      format: ExportFormat.CSV,
    });
    expect(exports.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedById: null,
        rowCount: null,
        status: ExportStatus.PENDING,
      }),
    );
  });

  it('ingest passes explicit optional fields through', async () => {
    exports.ingest.mockResolvedValue(makeExportLog());
    await controller.ingest({
      dataset: 'orders',
      requestedById: 'u-1',
      requestedByEmail: 'ops@x.com',
      format: ExportFormat.CSV,
      rowCount: 12,
      status: ExportStatus.DONE,
    });
    expect(exports.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedById: 'u-1', rowCount: 12, status: ExportStatus.DONE }),
    );
  });
});

describe('FraudFlagsController', () => {
  const fraud = {
    list: jest.fn(),
    review: jest.fn(),
    block: jest.fn(),
    clear: jest.fn(),
    ingest: jest.fn(),
  };
  const controller = new FraudFlagsController(fraud as unknown as FraudFlagService);
  beforeEach(() => jest.clearAllMocks());

  it('list forwards level/status filters', async () => {
    fraud.list.mockResolvedValue([makeFraudFlag()]);
    await controller.list({ level: FraudLevel.HIGH, status: FraudStatus.OPEN });
    expect(fraud.list).toHaveBeenCalledWith({ level: FraudLevel.HIGH, status: FraudStatus.OPEN });
  });

  it('review/block/clear delegate by id', async () => {
    fraud.review.mockResolvedValue(makeFraudFlag({ status: FraudStatus.REVIEWED }));
    fraud.block.mockResolvedValue(makeFraudFlag({ status: FraudStatus.BLOCKED }));
    fraud.clear.mockResolvedValue(makeFraudFlag({ status: FraudStatus.CLEARED }));
    expect((await controller.review('f-1')).status).toBe(FraudStatus.REVIEWED);
    expect((await controller.block('f-1')).status).toBe(FraudStatus.BLOCKED);
    expect((await controller.clear('f-1')).status).toBe(FraudStatus.CLEARED);
  });

  it('ingest forwards the scoring payload verbatim', async () => {
    fraud.ingest.mockResolvedValue(makeFraudFlag());
    await controller.ingest({
      entityType: FraudEntityType.ORDER,
      entityRef: 'ORD-1',
      score: 90,
      level: FraudLevel.HIGH,
      signals: ['velocity'],
      status: FraudStatus.OPEN,
    });
    expect(fraud.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ entityRef: 'ORD-1', score: 90 }),
    );
  });
});

describe('IncidentsController', () => {
  const incidents = { list: jest.fn(), create: jest.fn(), patch: jest.fn() };
  const controller = new IncidentsController(incidents as unknown as IncidentService);
  beforeEach(() => jest.clearAllMocks());

  it('list maps resolved (with updates) and unresolved incidents', async () => {
    incidents.list.mockResolvedValue([
      makeIncident({
        status: IncidentStatus.RESOLVED,
        resolvedAt: now,
        updates: [{ id: 'u-1', incidentId: 'i-1', note: 'fixed', createdAt: now }],
      }),
      makeIncident({ resolvedAt: null, updates: [] }),
    ]);
    const out = await controller.list({ status: IncidentStatus.RESOLVED });
    expect(incidents.list).toHaveBeenCalledWith({ status: IncidentStatus.RESOLVED });
    expect(out[0].resolvedAt).toBe(now.toISOString());
    expect(out[0].updates[0].note).toBe('fixed');
    expect(out[1].resolvedAt).toBeNull();
  });

  it('create defaults a missing note to null', async () => {
    incidents.create.mockResolvedValue(makeIncident());
    await controller.create({
      title: 'DB',
      severity: IncidentSeverity.CRITICAL,
      affectedService: 'order-service',
    });
    expect(incidents.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
  });

  it('create forwards an explicit note and patch delegates', async () => {
    incidents.create.mockResolvedValue(makeIncident({ note: 'opening' }));
    incidents.patch.mockResolvedValue(makeIncident());
    await controller.create({
      title: 'DB',
      severity: IncidentSeverity.WARNING,
      affectedService: 'order-service',
      note: 'opening',
    });
    expect(incidents.create).toHaveBeenCalledWith(expect.objectContaining({ note: 'opening' }));
    await controller.patch('i-1', { note: 'update', status: IncidentStatus.RESOLVED });
    expect(incidents.patch).toHaveBeenCalledWith('i-1', {
      note: 'update',
      status: IncidentStatus.RESOLVED,
    });
  });
});

describe('NotificationPrefsController', () => {
  const prefs = { get: jest.fn(), save: jest.fn() };
  const controller = new NotificationPrefsController(
    prefs as unknown as AdminNotificationPrefService,
  );
  const user = { sub: 'acc-1' } as AuthenticatedUser;
  const record: AdminNotificationPrefRecord = { accountId: 'acc-1', channels: [], updatedAt: now };
  beforeEach(() => jest.clearAllMocks());

  it('get reads the caller-scoped prefs', async () => {
    prefs.get.mockResolvedValue(record);
    await controller.get(user);
    expect(prefs.get).toHaveBeenCalledWith('acc-1');
  });

  it('save replaces the caller-scoped prefs', async () => {
    prefs.save.mockResolvedValue(record);
    const events = [{ id: 'order.new', push: true, email: false, wa: true }];
    await controller.save(user, { events });
    expect(prefs.save).toHaveBeenCalledWith('acc-1', events);
  });
});

describe('OnboardingController', () => {
  const onboarding = { get: jest.fn(), setStep: jest.fn() };
  const controller = new OnboardingController(onboarding as unknown as OnboardingStateService);
  const record: OnboardingStateRecord = {
    verify2fa: true,
    addDepot: false,
    inviteHeadOffice: false,
    setPricingTax: false,
    enablePayments: false,
    updatedAt: now,
  };
  beforeEach(() => jest.clearAllMocks());

  it('get reads the singleton state', async () => {
    onboarding.get.mockResolvedValue(record);
    expect((await controller.get()).verify2fa).toBe(true);
  });

  it('patch flips one step', async () => {
    onboarding.setStep.mockResolvedValue({ ...record, addDepot: true });
    await controller.patch({ step: 'addDepot', done: true });
    expect(onboarding.setStep).toHaveBeenCalledWith('addDepot', true);
  });
});

describe('RetentionController', () => {
  const retention = {
    listPolicies: jest.fn(),
    getBackupStatus: jest.fn(),
    recordBackupRun: jest.fn(),
    updatePolicy: jest.fn(),
  };
  const purge = { run: jest.fn() };
  const controller = new RetentionController(
    retention as unknown as RetentionService,
    purge as never,
  );
  beforeEach(() => jest.clearAllMocks());

  it('runPurge only dry-runs when the query says exactly "true"', async () => {
    purge.run.mockResolvedValue({ ranAt: 'now', dryRun: false, entries: [], totalDeleted: 0, unenforced: [] });
    await controller.runPurge('true');
    expect(purge.run).toHaveBeenCalledWith({ dryRun: true });
    await controller.runPurge('yes');
    expect(purge.run).toHaveBeenLastCalledWith({ dryRun: false });
    await controller.runPurge();
    expect(purge.run).toHaveBeenLastCalledWith({ dryRun: false });
  });

  it('get maps policies + backup status with a real lastBackupAt', async () => {
    retention.listPolicies.mockResolvedValue([makeRetentionPolicy()]);
    const backup: BackupStatusRecord = {
      status: 'OK',
      lastBackupAt: now,
      detail: '1.2G, 16 databases',
      drillStatus: 'OK',
      lastDrillAt: now,
      drillDetail: '16 databases restored',
    };
    retention.getBackupStatus.mockResolvedValue(backup);
    const out = await controller.get();
    expect(out.policies).toHaveLength(1);
    expect(out.backup.lastBackupAt).toBe(now.toISOString());
  });

  it('get maps a never-run backup status (null lastBackupAt)', async () => {
    retention.listPolicies.mockResolvedValue([]);
    const backup: BackupStatusRecord = {
      status: 'NONE',
      lastBackupAt: null,
      detail: null,
      drillStatus: 'NONE',
      lastDrillAt: null,
      drillDetail: null,
    };
    retention.getBackupStatus.mockResolvedValue(backup);
    const out = await controller.get();
    expect(out.backup.lastBackupAt).toBeNull();
  });

  // H-37: the endpoint the VPS cron jobs POST to. It stamps `at` server-side so a wrong
  // clock on the box cannot backdate a backup into looking fresher than it is.
  it('recordBackupRun stamps the time server-side and maps the result', async () => {
    retention.recordBackupRun.mockResolvedValue({
      status: 'OK',
      lastBackupAt: now,
      detail: '1.2G',
      drillStatus: 'NONE',
      lastDrillAt: null,
      drillDetail: null,
    });
    const out = await controller.recordBackupRun({ kind: 'BACKUP', status: 'OK', detail: '1.2G' });
    expect(retention.recordBackupRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'BACKUP', status: 'OK', detail: '1.2G', at: expect.any(Date) }),
    );
    expect(out.drillStatus).toBe('NONE');
    expect(out.lastDrillAt).toBeNull();
  });

  it('recordBackupRun normalises a missing detail to null', async () => {
    retention.recordBackupRun.mockResolvedValue({
      status: 'NONE',
      lastBackupAt: null,
      detail: null,
      drillStatus: 'FAILED',
      lastDrillAt: now,
      drillDetail: null,
    });
    await controller.recordBackupRun({ kind: 'DRILL', status: 'FAILED' });
    expect(retention.recordBackupRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'DRILL', detail: null }),
    );
  });

  it('update delegates the window change', async () => {
    retention.updatePolicy.mockResolvedValue(makeRetentionPolicy({ windowDays: 30 }));
    await controller.update('r-1', { windowLabel: '30 days', windowDays: 30 });
    expect(retention.updatePolicy).toHaveBeenCalledWith('r-1', {
      windowLabel: '30 days',
      windowDays: 30,
    });
  });
});

describe('ScheduledReportsController', () => {
  const reports = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const runner = { runDue: jest.fn().mockResolvedValue({ due: 2, produced: 2, failed: 0 }) };
  const controller = new ScheduledReportsController(
    reports as unknown as ScheduledReportService,
    runner as never,
  );
  beforeEach(() => jest.clearAllMocks());

  it('runDue delegates to the sweep and returns its counts', async () => {
    await expect(controller.runDue()).resolves.toEqual({ due: 2, produced: 2, failed: 0 });
    expect(runner.runDue).toHaveBeenCalled();
  });

  it('list maps records with and without a nextRunAt', async () => {
    reports.list.mockResolvedValue([
      makeScheduledReport({ nextRunAt: now }),
      makeScheduledReport({ nextRunAt: null }),
    ]);
    const out = await controller.list();
    expect(out[0].nextRunAt).toBe(now.toISOString());
    expect(out[1].nextRunAt).toBeNull();
  });

  it('create/update/remove delegate', async () => {
    reports.create.mockResolvedValue(makeScheduledReport());
    reports.update.mockResolvedValue(makeScheduledReport({ enabled: false }));
    reports.remove.mockResolvedValue(undefined);
    await controller.create({
      name: 'Weekly',
      cadence: ReportCadence.WEEKLY,
      recipients: ['ops@x.com'],
    });
    expect(reports.create).toHaveBeenCalled();
    expect((await controller.update('s-1', { enabled: false })).enabled).toBe(false);
    await controller.remove('s-1');
    expect(reports.remove).toHaveBeenCalledWith('s-1');
  });
});

describe('SecurityPolicyController', () => {
  const policy = { get: jest.fn(), save: jest.fn() };
  const controller = new SecurityPolicyController(policy as unknown as SecurityPolicyService);
  const record: SecurityPolicyRecord = {
    idleTimeoutMinutes: 30,
    require2fa: true,
    ipAllowlist: ['10.0.0.0/8'],
    updatedAt: now,
  };
  beforeEach(() => jest.clearAllMocks());

  it('get and save delegate', async () => {
    policy.get.mockResolvedValue(record);
    policy.save.mockResolvedValue(record);
    expect((await controller.get()).idleTimeoutMinutes).toBe(30);
    const dto = { idleTimeoutMinutes: 15, require2fa: false, ipAllowlist: [] };
    await controller.save(dto);
    expect(policy.save).toHaveBeenCalledWith(dto);
  });
});

describe('SlaPolicyController', () => {
  const policy = { get: jest.fn(), save: jest.fn() };
  const controller = new SlaPolicyController(policy as unknown as SlaPolicyService);
  const record: SlaPolicyRecord = {
    onTimeThresholdMinutes: 60,
    healthyBandPct: 90,
    criticalBandPct: 70,
    updatedAt: now,
  };
  beforeEach(() => jest.clearAllMocks());

  it('get and save delegate', async () => {
    policy.get.mockResolvedValue(record);
    policy.save.mockResolvedValue(record);
    expect((await controller.get()).onTimeThresholdMinutes).toBe(60);
    const dto = { onTimeThresholdMinutes: 45, healthyBandPct: 95, criticalBandPct: 60 };
    await controller.save(dto);
    expect(policy.save).toHaveBeenCalledWith(dto);
  });
});

describe('SupportTicketsController', () => {
  const tickets = {
    list: jest.fn(),
    get: jest.fn(),
    reply: jest.fn(),
    assign: jest.fn(),
    resolve: jest.fn(),
  };
  const controller = new SupportTicketsController(tickets as unknown as SupportTicketService);
  const withMessage = makeSupportTicket({
    messages: [
      {
        id: 'm-1',
        ticketId: 't-1',
        authorType: TicketAuthorType.STAFF,
        body: 'on it',
        createdAt: now,
      },
    ],
  });
  beforeEach(() => jest.clearAllMocks());

  it('list forwards status/priority filters and maps the message thread', async () => {
    tickets.list.mockResolvedValue([withMessage]);
    const out = await controller.list({ status: TicketStatus.OPEN, priority: TicketPriority.HIGH });
    expect(tickets.list).toHaveBeenCalledWith({
      status: TicketStatus.OPEN,
      priority: TicketPriority.HIGH,
    });
    expect(out[0].messages[0].body).toBe('on it');
  });

  it('get/reply/assign/resolve delegate', async () => {
    tickets.get.mockResolvedValue(withMessage);
    tickets.reply.mockResolvedValue(withMessage);
    tickets.assign.mockResolvedValue(
      makeSupportTicket({ assigneeId: 'staff-1', status: TicketStatus.ASSIGNED }),
    );
    tickets.resolve.mockResolvedValue(makeSupportTicket({ status: TicketStatus.RESOLVED }));
    await controller.get('t-1');
    await controller.reply('t-1', { body: 'hi' });
    expect(tickets.reply).toHaveBeenCalledWith('t-1', 'hi');
    await controller.assign('t-1', { assigneeId: 'staff-1' });
    expect(tickets.assign).toHaveBeenCalledWith('t-1', 'staff-1');
    expect((await controller.resolve('t-1')).status).toBe(TicketStatus.RESOLVED);
  });
});

describe('WebhooksController', () => {
  const webhooks = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const controller = new WebhooksController(webhooks as unknown as WebhookService);
  const record: WebhookRecord = {
    id: 'w-1',
    url: 'https://x.com/hook',
    events: ['order.created'],
    active: true,
    secret: null,
    lastDeliveryStatus: null,
    deliveryRatePct: null,
    createdAt: now,
  };
  beforeEach(() => jest.clearAllMocks());

  it('list/create/update/remove delegate', async () => {
    webhooks.list.mockResolvedValue([record]);
    webhooks.create.mockResolvedValue(record);
    webhooks.update.mockResolvedValue({ ...record, active: false });
    webhooks.remove.mockResolvedValue(undefined);
    expect((await controller.list())[0].url).toBe('https://x.com/hook');
    await controller.create({ url: 'https://x.com/hook', events: ['order.created'] });
    expect(webhooks.create).toHaveBeenCalled();
    expect((await controller.update('w-1', { active: false })).active).toBe(false);
    await controller.remove('w-1');
    expect(webhooks.remove).toHaveBeenCalledWith('w-1');
  });
});
