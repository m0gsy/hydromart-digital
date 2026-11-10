import { StaleWriteError } from '@hydromart/platform';

import { RetentionService } from '../../src/application/services/retention.service';
import { SecurityPolicyService } from '../../src/application/services/security-policy.service';
import { SlaPolicyService } from '../../src/application/services/sla-policy.service';
import { SystemSettingsService } from '../../src/application/services/system-settings.service';
import { RetentionPrismaRepository } from '../../src/infrastructure/prisma/retention.prisma.repository';
import { SecurityPolicyPrismaRepository } from '../../src/infrastructure/prisma/security-policy.prisma.repository';
import { SlaPolicyPrismaRepository } from '../../src/infrastructure/prisma/sla-policy.prisma.repository';
import { SystemSettingsPrismaRepository } from '../../src/infrastructure/prisma/system-settings.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  InMemoryRetentionRepository,
  InMemorySecurityPolicyRepository,
  InMemorySlaPolicyRepository,
  InMemorySystemSettingsRepository,
  makeRetentionPolicy,
} from '../support/fakes';

/*
 * AAS-13. The services checked the stamp (assertFresh) and THEN wrote: two admins who both passed the
 * check let the slower one overwrite the faster. The write now re-checks the stamp in the same
 * statement. Each test slips a concurrent write in BETWEEN the service's read and its write, which is
 * exactly the window the old code left open.
 */
describe('AAS-13 · the write itself refuses a row that moved after it was read', () => {
  const bump = (row: { updatedAt: Date }) => {
    row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
  };

  it('security policy', async () => {
    const repo = new InMemorySecurityPolicyRepository();
    const service = new SecurityPolicyService(repo);
    const first = await service.save({ idleTimeoutMinutes: 30, require2fa: false, ipAllowlist: [] });
    const realGet = repo.get.bind(repo);
    jest.spyOn(repo, 'get').mockImplementationOnce(async () => {
      const seen = await realGet();
      bump(repo.row!); // somebody else saves right after our read
      return seen;
    });
    await expect(
      service.save({ idleTimeoutMinutes: 45, require2fa: true, ipAllowlist: [] }, first.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(repo.row!.idleTimeoutMinutes).toBe(30); // nothing was overwritten
  });

  it('SLA policy', async () => {
    const repo = new InMemorySlaPolicyRepository();
    const service = new SlaPolicyService(repo);
    const first = await service.save({ onTimeThresholdMinutes: 90, healthyBandPct: 95, criticalBandPct: 85 });
    const realGet = repo.get.bind(repo);
    jest.spyOn(repo, 'get').mockImplementationOnce(async () => {
      const seen = await realGet();
      bump(repo.row!);
      return seen;
    });
    await expect(
      service.save({ onTimeThresholdMinutes: 60, healthyBandPct: 95, criticalBandPct: 85 }, first.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(repo.row!.onTimeThresholdMinutes).toBe(90);
  });

  it('platform settings', async () => {
    const repo = new InMemorySystemSettingsRepository();
    const service = new SystemSettingsService(repo);
    const first = await service.save({ defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 5 });
    const realGet = repo.get.bind(repo);
    jest.spyOn(repo, 'get').mockImplementationOnce(async () => {
      const seen = await realGet();
      bump(repo.row!);
      return seen;
    });
    await expect(
      service.save({ defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 9 }, first.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(repo.row!.serviceRadiusKm).toBe(5);
  });

  it('retention policy', async () => {
    const repo = new InMemoryRetentionRepository();
    const row = makeRetentionPolicy({ windowDays: 365 });
    repo.rows = [row];
    const service = new RetentionService(repo);
    const realFind = repo.findPolicy.bind(repo);
    jest.spyOn(repo, 'findPolicy').mockImplementationOnce(async (id: string) => {
      const seen = await realFind(id);
      bump(repo.rows[0]!);
      return seen;
    });
    await expect(
      service.updatePolicy(row.id, { windowLabel: '2 tahun', windowDays: 730 }, row.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(repo.rows[0]!.windowDays).toBe(365);
  });

  it('an uncontended save still goes through, and a first save (no row yet) creates it', async () => {
    const repo = new InMemorySlaPolicyRepository();
    const service = new SlaPolicyService(repo);
    const first = await service.save({ onTimeThresholdMinutes: 90, healthyBandPct: 95, criticalBandPct: 85 });
    const second = await service.save(
      { onTimeThresholdMinutes: 80, healthyBandPct: 95, criticalBandPct: 85 },
      first.updatedAt.toISOString(),
    );
    expect(second.onTimeThresholdMinutes).toBe(80);
  });
});

describe('AAS-13 · the Prisma writes are one conditional statement', () => {
  const STAMP = new Date('2026-11-10T01:00:00.000Z');
  const rowFor = (over: Record<string, unknown>) => ({ id: 'singleton', updatedAt: STAMP, ...over });

  it.each([
    ['securityPolicy', SecurityPolicyPrismaRepository, { idleTimeoutMinutes: 30, require2fa: false, ipAllowlist: [] }],
    ['slaPolicy', SlaPolicyPrismaRepository, { onTimeThresholdMinutes: 90, healthyBandPct: 95, criticalBandPct: 85 }],
    ['systemSetting', SystemSettingsPrismaRepository, { defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 5 }],
  ] as const)('%s: updateMany WHERE updatedAt, and a lost race throws', async (model, Repo, data) => {
    const m = { updateMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() };
    const repo = new (Repo as new (p: PrismaService) => { save(d: unknown, at?: Date): Promise<unknown> })({ [model]: m } as unknown as PrismaService);

    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.findUnique.mockResolvedValueOnce(rowFor(data));
    await repo.save(data, STAMP);
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 'singleton', updatedAt: STAMP }, data });
    expect(m.upsert).not.toHaveBeenCalled();

    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.save(data, STAMP)).rejects.toBeInstanceOf(StaleWriteError);

    // No stamp (a first save) keeps the upsert.
    m.upsert.mockResolvedValueOnce(rowFor(data));
    await repo.save(data);
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });

  it('retention: updateMany WHERE id and updatedAt, a lost race throws, no stamp keeps the plain update', async () => {
    const m = { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn(), update: jest.fn() };
    const repo = new RetentionPrismaRepository({ retentionPolicy: m } as unknown as PrismaService);
    const full = {
      id: 'r1', dataset: 'pod', windowLabel: '1 tahun', windowDays: 365, dataClass: 'OPERATIONAL', updatedAt: STAMP,
    };
    m.findUnique.mockResolvedValue(full);
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.findUniqueOrThrow.mockResolvedValueOnce({ ...full, windowDays: 730 });
    const out = await repo.updatePolicy('r1', { windowLabel: '2 tahun', windowDays: 730 }, STAMP);
    expect(out?.windowDays).toBe(730);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', updatedAt: STAMP },
      data: { windowLabel: '2 tahun', windowDays: 730 },
    });

    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.updatePolicy('r1', { windowLabel: 'x', windowDays: 1 }, STAMP)).rejects.toBeInstanceOf(StaleWriteError);

    m.update.mockResolvedValueOnce(full);
    await repo.updatePolicy('r1', { windowLabel: 'x', windowDays: 1 });
    expect(m.update).toHaveBeenCalledTimes(1);
  });
});
