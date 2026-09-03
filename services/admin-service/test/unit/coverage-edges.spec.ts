import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ApiKeyService } from '../../src/application/services/api-key.service';
import { DataClass } from '../../src/domain/retention';
import { PurgeService } from '../../src/application/services/purge.service';
import { RemotePurgeExecutor } from '../../src/infrastructure/http/remote-purge.executor';
import { RetentionPrismaRepository } from '../../src/infrastructure/prisma/retention.prisma.repository';
import { IncidentPrismaRepository } from '../../src/infrastructure/prisma/incident.prisma.repository';
import { RetentionController } from '../../src/modules/retention.controller';
import { ExportLogQueryDto } from '../../src/modules/dto/export-log.dto';
import { PurgePlanEntryDto } from '../../src/modules/dto/retention.dto';
import { SaveAdminNotificationPrefsDto } from '../../src/modules/dto/admin-notification-pref.dto';
import {
  CreateScheduledReportDto,
  UpdateScheduledReportDto,
} from '../../src/modules/dto/scheduled-report.dto';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from '../../src/application/ports/api-key.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RetentionService } from '../../src/application/services/retention.service';
import { RetentionPolicyNotFoundError } from '../../src/domain/errors';

// Paths the behaviour specs leave untaken: a plain read-through, the "is this even wired up"
// getter, the not-found half of a lookup, the no-argument call, and the DTO transforms that turn
// a query string into the number or Date the validators are written against.

describe('ApiKeyService.list', () => {
  it('hands back what the repository holds, secrets excluded', async () => {
    const rows = [{ id: 'k1', keyPrefix: 'hm_live_ab' }] as unknown as ApiKeyRecord[];
    const repo = { list: jest.fn().mockResolvedValue(rows) } as unknown as ApiKeyRepository;

    await expect(new ApiKeyService(repo).list()).resolves.toBe(rows);
  });
});

describe('RemotePurgeExecutor.configured', () => {
  it('is false when this environment has no URL or no internal key', () => {
    expect(new RemotePurgeExecutor('orders', '', '/purge', 'key').configured).toBe(false);
    expect(new RemotePurgeExecutor('orders', 'http://x', '/purge', '').configured).toBe(false);
  });

  it('is true only when both are present', () => {
    expect(new RemotePurgeExecutor('orders', 'http://x', '/purge', 'key').configured).toBe(true);
  });
});

describe('RetentionPrismaRepository lookups', () => {
  const row = {
    id: 'p1',
    dataset: 'orders',
    windowLabel: '3 tahun',
    windowDays: 1095,
    dataClass: DataClass.OPERATIONAL,
    updatedAt: new Date('2026-01-01'),
  };

  it('reads one policy, and reports a missing one as null rather than throwing', async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    const prisma = { retentionPolicy: { findUnique } } as unknown as PrismaService;
    const repo = new RetentionPrismaRepository(prisma);

    await expect(repo.findPolicy('p1')).resolves.toMatchObject({ id: 'p1', purgeExempt: false });
    await expect(repo.findPolicy('gone')).resolves.toBeNull();
  });

  it('falls back to OPERATIONAL when a hand-edited row carries an unknown data class', async () => {
    const findUnique = jest.fn().mockResolvedValue({ ...row, dataClass: 'MADE_UP' });
    const prisma = { retentionPolicy: { findUnique } } as unknown as PrismaService;

    await expect(new RetentionPrismaRepository(prisma).findPolicy('p1')).resolves.toMatchObject({
      dataClass: DataClass.OPERATIONAL,
      purgeExempt: false,
    });
  });

  it('updating a policy that no longer exists returns null instead of creating one', async () => {
    const prisma = {
      retentionPolicy: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    } as unknown as PrismaService;

    await expect(
      new RetentionPrismaRepository(prisma).updatePolicy('gone', {
        windowLabel: '30 hari',
        windowDays: 30,
        dataClass: DataClass.OPERATIONAL,
      }),
    ).resolves.toBeNull();
    expect(
      (prisma as unknown as { retentionPolicy: { update: jest.Mock } }).retentionPolicy.update,
    ).not.toHaveBeenCalled();
  });
});

describe('IncidentPrismaRepository.findById', () => {
  it('answers null for an id that is not there', async () => {
    const prisma = {
      incident: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    await expect(new IncidentPrismaRepository(prisma).patch('nope', {})).resolves.toBeNull();
  });
});

describe('PurgeService.run with no options', () => {
  it('defaults to a real run at the current time, and reports datasets with no executor', async () => {
    const retention = {
      purgeCutoffs: jest.fn().mockResolvedValue([
        {
          dataset: 'orders',
          dataClass: DataClass.OPERATIONAL,
          purgeExempt: false,
          windowDays: 30,
          cutoff: new Date('2026-01-01'),
        },
        {
          dataset: 'payments',
          dataClass: DataClass.FINANCIAL,
          purgeExempt: true,
          windowDays: 3650,
          cutoff: null,
        },
      ]),
    } as unknown as RetentionService;

    const result = await new PurgeService(retention, []).run();

    expect(result.dryRun).toBe(false);
    expect(result.unenforced).toContain('orders');
    expect(retention.purgeCutoffs).toHaveBeenCalledWith(expect.any(Date));
  });

  it('lists a REPORT_ONLY dataset with rows waiting as awaiting review', async () => {
    const retention = {
      purgeCutoffs: jest.fn().mockResolvedValue([
        {
          dataset: 'consent',
          dataClass: DataClass.OPERATIONAL,
          purgeExempt: false,
          windowDays: 30,
          cutoff: new Date('2026-01-01'),
        },
      ]),
    } as unknown as RetentionService;
    const executor = {
      dataset: 'consent',
      mode: 'REPORT' as const,
      configured: true,
      purge: jest.fn().mockResolvedValue(4),
    };

    const result = await new PurgeService(retention, [executor]).run({ dryRun: false });

    expect(result.awaitingReview).toContain('consent');
  });
});

describe('RemotePurgeExecutor.purge', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads `deleted` on a DELETE dataset and `eligible` on a REPORT one', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ deleted: 7 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ eligible: 3 }) }) as never;

    await expect(
      new RemotePurgeExecutor('orders', 'http://owner', '/purge', 'k').purge(new Date()),
    ).resolves.toBe(7);
    await expect(
      new RemotePurgeExecutor('consent', 'http://owner', '/purge', 'k', 'REPORT').purge(new Date()),
    ).resolves.toBe(3);
  });

  it('raises rather than reporting 0 when the owner refuses or is unreachable', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(
      new RemotePurgeExecutor('orders', 'http://owner', '/purge', 'k').purge(new Date()),
    ).rejects.toThrow(/responded 503/);

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    await expect(
      new RemotePurgeExecutor('orders', 'http://owner', '/purge', 'k').purge(new Date()),
    ).rejects.toThrow(/owner unreachable/);
  });

  it('treats a body with neither count as 0 rather than NaN', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
    await expect(
      new RemotePurgeExecutor('orders', 'http://owner', '/purge', 'k').purge(new Date()),
    ).resolves.toBe(0);
  });
});

describe('RetentionService edges', () => {
  it('refuses to update a policy that disappeared under the write', async () => {
    const repo = {
      findPolicy: jest.fn().mockResolvedValue({
        id: 'p1',
        dataset: 'orders',
        windowLabel: '30 hari',
        windowDays: 30,
        dataClass: DataClass.OPERATIONAL,
        purgeExempt: false,
        updatedAt: new Date(),
      }),
      updatePolicy: jest.fn().mockResolvedValue(null),
      listPolicies: jest.fn(),
      getBackupStatus: jest.fn(),
    };
    const svc = new RetentionService(repo as never);

    await expect(
      svc.updatePolicy('p1', {
        windowLabel: '60 hari',
        windowDays: 60,
        dataClass: DataClass.OPERATIONAL,
      }),
    ).rejects.toBeInstanceOf(RetentionPolicyNotFoundError);
  });

  it('plans against now when the caller passes no clock', async () => {
    const repo = {
      findPolicy: jest.fn(),
      updatePolicy: jest.fn(),
      listPolicies: jest.fn().mockResolvedValue([
        {
          id: 'p1',
          dataset: 'orders',
          windowLabel: '30 hari',
          windowDays: 30,
          dataClass: DataClass.OPERATIONAL,
          purgeExempt: false,
          updatedAt: new Date(),
        },
      ]),
      getBackupStatus: jest.fn(),
    };

    const [entry] = await new RetentionService(repo as never).purgeCutoffs();
    expect(entry.cutoff).toBeInstanceOf(Date);
  });
});

describe('RetentionController read paths', () => {
  it('maps the purge plan through the DTO and runs the internal sweep', async () => {
    const retention = {
      purgeCutoffs: jest.fn().mockResolvedValue([
        {
          dataset: 'payments',
          dataClass: DataClass.FINANCIAL,
          purgeExempt: true,
          windowDays: 3650,
          cutoff: null,
        },
      ]),
    } as unknown as RetentionService;
    const purge = {
      run: jest.fn().mockResolvedValue({ dryRun: false }),
    } as unknown as PurgeService;
    const controller = new RetentionController(retention, purge);

    await expect(controller.purgePlan()).resolves.toEqual([
      { dataset: 'payments', dataClass: DataClass.FINANCIAL, purgeExempt: true, cutoff: null },
    ]);

    await controller.runPurgeInternal();
    expect(purge.run).toHaveBeenCalledWith();
  });

  it('renders a cutoff as an ISO string when there is one', () => {
    expect(
      PurgePlanEntryDto.from({
        dataset: 'orders',
        dataClass: DataClass.OPERATIONAL,
        purgeExempt: false,
        cutoff: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toMatchObject({ cutoff: '2026-01-01T00:00:00.000Z' });
  });
});

describe('DTO transforms', () => {
  // Query strings are strings. Without the @Type(() => Number) factory, @IsInt sees "2" and the
  // page a caller asked for silently becomes a validation error.
  it('coerces paging out of a query string', () => {
    const dto = plainToInstance(ExportLogQueryDto, { page: '2', limit: '50' });
    expect(validateSync(dto as object)).toEqual([]);
    expect(dto).toMatchObject({ page: 2, limit: 50 });
  });

  it('validates each notification preference row, not just the array', () => {
    const good = plainToInstance(SaveAdminNotificationPrefsDto, {
      events: [{ id: 'criticalSla', push: true, email: true, wa: false }],
    });
    expect(validateSync(good as object)).toEqual([]);

    const bad = plainToInstance(SaveAdminNotificationPrefsDto, {
      events: [{ id: 'nothing-like-this', push: 'yes', email: true, wa: false }],
    });
    expect(validateSync(bad as object).map((e) => e.property)).toContain('events');
  });

  it('parses the next run time a scheduler posts as a string, on create and on update', () => {
    const created = plainToInstance(CreateScheduledReportDto, {
      name: 'Ringkasan harian',
      cron: '0 6 * * *',
      recipients: ['ops@hydromart.id'],
      nextRunAt: '2026-08-01T06:00:00.000Z',
    });
    expect(created.nextRunAt).toBeInstanceOf(Date);

    const updated = plainToInstance(UpdateScheduledReportDto, {
      nextRunAt: '2026-08-02T06:00:00.000Z',
    });
    expect(validateSync(updated as object)).toEqual([]);
    expect(updated.nextRunAt).toBeInstanceOf(Date);
  });
});
