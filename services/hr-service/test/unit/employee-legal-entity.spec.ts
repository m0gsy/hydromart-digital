import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser, StaleWriteError } from '@hydromart/platform';

import { AuditWrite } from '../../src/application/ports/audit.repository';
import {
  AssignEmployeesData,
  AssignedEmployee,
  EmployeeLegalEntityRepository,
} from '../../src/application/ports/employee-legal-entity.repository';
import { LegalEntityDirectoryPort, LegalEntitySummary } from '../../src/application/ports/legal-entity-directory.port';
import { AuditService } from '../../src/application/services/audit.service';
import { EmployeeLegalEntityService } from '../../src/application/services/employee-legal-entity.service';
import {
  EmployeeLegalEntityHistory,
  EmployeeLegalEntityPoint,
  formatCalendarDay,
  parseCalendarDay,
} from '../../src/domain/legal-entity';
import { LegalEntityDirectoryHttpAdapter } from '../../src/infrastructure/http/legal-entity-directory.http.adapter';
import { EmployeeLegalEntityPrismaRepository } from '../../src/infrastructure/prisma/employee-legal-entity.prisma.repository';
import { EmployeeLegalEntityController } from '../../src/modules/employee-legal-entity.controller';

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const LE = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-22T03:00:00.000Z');

/** The Prisma repository's rules in memory: one point per employee per day, checked against what the screen saw. */
class FakePoints implements EmployeeLegalEntityRepository {
  employees = [E1, E2];
  points: EmployeeLegalEntityPoint[] = [];
  async histories(): Promise<EmployeeLegalEntityHistory[]> {
    return this.employees.map((id) => ({
      employeeId: id,
      employeeCode: `HR-${id.slice(0, 4)}`,
      fullName: 'Budi',
      position: 'Kasir',
      depotId: null,
      status: 'ACTIVE',
      points: this.points.filter((p) => p.employeeId === id),
    }));
  }
  async existingEmployeeIds(ids: string[]): Promise<string[]> {
    return ids.filter((id) => this.employees.includes(id));
  }
  async assign(data: AssignEmployeesData): Promise<AssignedEmployee[]> {
    const day = formatCalendarDay(data.effectiveFrom);
    const at = (id: string) => this.points.find((p) => p.employeeId === id && p.effectiveFrom === day);
    const stale = (id: string) => {
      const stored = at(id)?.legalEntityId ?? null;
      return stored !== (data.seen.get(id) ?? null) && stored !== data.legalEntityId;
    };
    if (data.employeeIds.some(stale)) throw new StaleWriteError();
    const out: AssignedEmployee[] = [];
    for (const employeeId of data.employeeIds) {
      const row = at(employeeId);
      if (row?.legalEntityId === data.legalEntityId) continue;
      out.push({ employeeId, replaced: row?.legalEntityId ?? null });
      if (row) row.legalEntityId = data.legalEntityId;
      else
        this.points.push({
          id: `p${this.points.length}`,
          employeeId,
          legalEntityId: data.legalEntityId,
          effectiveFrom: day,
          recordedBy: data.recordedBy,
          recordedAt: NOW,
        });
    }
    return out;
  }
  async remove(id: string, seenLegalEntityId: string): Promise<EmployeeLegalEntityPoint | null> {
    const found = this.points.find((p) => p.id === id) ?? null;
    if (found && found.legalEntityId !== seenLegalEntityId) throw new StaleWriteError();
    this.points = this.points.filter((p) => p.id !== id);
    return found;
  }
}

class FakeDirectory implements LegalEntityDirectoryPort {
  known = new Map<string, LegalEntitySummary>([[LE, { id: LE, name: 'PT Kelola Air', kind: 'OPERATOR', active: true }]]);
  async find(id: string): Promise<LegalEntitySummary | null> {
    return this.known.get(id) ?? null;
  }
}

describe('calendar days', () => {
  it('reads only a real calendar day', () => {
    expect(parseCalendarDay('2026-12-01')?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(parseCalendarDay('2026-02-30')).toBeNull();
    expect(parseCalendarDay('2026-1-1')).toBeNull();
  });
});

describe('EmployeeLegalEntityService + controller', () => {
  let points: FakePoints;
  let directory: FakeDirectory;
  let trail: AuditWrite[];
  let controller: EmployeeLegalEntityController;
  const user = { sub: ACTOR, role: 'HEAD_OFFICE' } as unknown as AuthenticatedUser;

  beforeEach(() => {
    points = new FakePoints();
    directory = new FakeDirectory();
    trail = [];
    const audit = { record: async (entry: AuditWrite) => void trail.push(entry) } as unknown as AuditService;
    controller = new EmployeeLegalEntityController(new EmployeeLegalEntityService(points, directory, audit));
  });

  it('dates employees, leaves an unchanged day alone, corrects a day it saw, and trails before/after', async () => {
    const body = { employeeIds: [E1, E1, E2], legalEntityId: LE, effectiveFrom: '2026-12-01', seen: [] };
    expect(await controller.assign(body, user)).toEqual([
      { employeeId: E1, replaced: null },
      { employeeId: E2, replaced: null },
    ]);
    const sawKelola = [
      { id: E1, legalEntityId: LE },
      { id: E2, legalEntityId: LE },
    ];
    expect(await controller.assign({ ...body, seen: sawKelola }, user)).toEqual([]);
    directory.known.set(OTHER, { id: OTHER, name: 'PT Indo', kind: 'FRANCHISOR', active: true });
    expect(
      await controller.assign({ ...body, employeeIds: [E1], legalEntityId: OTHER, seen: [sawKelola[0]] }, user),
    ).toEqual([{ employeeId: E1, replaced: LE }]);
    const histories = await controller.histories();
    expect(histories[0].points).toEqual([expect.objectContaining({ legalEntityId: OTHER, recordedBy: ACTOR })]);
    // Two writes happened (the unchanged save left no row), each with what it replaced.
    expect(trail.map((t) => t.action)).toEqual(['employee_legal_entity.assign', 'employee_legal_entity.assign']);
    expect(trail[1]).toMatchObject({
      actorId: ACTOR,
      entityId: OTHER,
      before: { replaced: [{ employeeId: E1, legalEntityId: LE }] },
      after: { legalEntityId: OTHER, effectiveFrom: '2026-12-01', employeeIds: [E1] },
    });
  });

  it('refuses to correct a day the screen did not see as it is now; a retry is no conflict', async () => {
    const body = { employeeIds: [E1], legalEntityId: LE, effectiveFrom: '2026-12-01', seen: [] };
    await controller.assign(body, user);
    expect(await controller.assign(body, user)).toEqual([]);
    directory.known.set(OTHER, { id: OTHER, name: 'PT Indo', kind: 'FRANCHISOR', active: true });
    await expect(controller.assign({ ...body, legalEntityId: OTHER }, user)).rejects.toBeInstanceOf(StaleWriteError);
  });

  it('takes ids in either case, as one spelling', async () => {
    const body = {
      employeeIds: [E1.toUpperCase(), E1],
      legalEntityId: LE.toUpperCase(),
      effectiveFrom: '2026-12-01',
      seen: [],
    };
    expect(await controller.assign(body, user)).toEqual([{ employeeId: E1, replaced: null }]);
    directory.known.set(OTHER, { id: OTHER, name: 'PT Indo', kind: 'FRANCHISOR', active: true });
    expect(
      await controller.assign(
        { ...body, legalEntityId: OTHER, seen: [{ id: E1.toUpperCase(), legalEntityId: LE.toUpperCase() }] },
        user,
      ),
    ).toEqual([{ employeeId: E1, replaced: LE }]);
  });

  it('refuses a day that is not one, an unknown or switched-off entity, and an unknown employee', async () => {
    const body = { employeeIds: [E1], legalEntityId: LE, effectiveFrom: '2026-02-30', seen: [] };
    await expect(controller.assign(body, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.assign({ ...body, effectiveFrom: '2026-12-01', legalEntityId: E2 }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.assign({ ...body, effectiveFrom: '2026-12-01', employeeIds: [ACTOR] }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    directory.known.set(LE, { id: LE, name: 'PT Kelola Air', kind: 'OPERATOR', active: false });
    await expect(controller.assign({ ...body, effectiveFrom: '2026-12-01' }, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(trail).toEqual([]);
  });

  it('takes back one point and trails what it held, and is 404 for one that is gone', async () => {
    await controller.assign({ employeeIds: [E1], legalEntityId: LE, effectiveFrom: '2026-12-01', seen: [] }, user);
    trail = [];
    // A screen that showed another entity on that point does not delete it blind.
    await expect(controller.remove('p0', { legalEntityId: OTHER }, user)).rejects.toBeInstanceOf(StaleWriteError);
    await expect(controller.remove('p0', { legalEntityId: LE.toUpperCase() }, user)).resolves.toBeUndefined();
    expect(trail).toEqual([
      expect.objectContaining({
        action: 'employee_legal_entity.remove',
        entityId: LE,
        before: expect.objectContaining({ employeeId: E1, legalEntityId: LE, effectiveFrom: '2026-12-01' }),
        after: null,
      }),
    ]);
    await expect(controller.remove('p0', { legalEntityId: LE }, user)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LegalEntityDirectoryHttpAdapter', () => {
  const cfg = (url = 'http://depot:3007/', internalKey = 'k') => ({ depotService: { url, internalKey } }) as never;
  afterEach(() => jest.restoreAllMocks());

  it('asks depot-service with the internal key; only a literal true is active', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: LE, name: 'PT A', kind: 'OPERATOR', active: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: LE, name: 'PT A', kind: 'OPERATOR' })));
    const a = new LegalEntityDirectoryHttpAdapter(cfg());
    await expect(a.find(LE)).resolves.toEqual({ id: LE, name: 'PT A', kind: 'OPERATOR', active: true });
    await expect(a.find(LE)).resolves.toMatchObject({ active: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://depot:3007/api/v1/legal-entities/internal/${LE}`);
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it('a 404 is "no such entity"; anything else is a 503, never a guess', async () => {
    const a = new LegalEntityDirectoryHttpAdapter(cfg());
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(a.find(LE)).resolves.toBeNull();
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(a.find(LE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(a.find(LE)).rejects.toThrow(/tidak terjangkau/);
    jest.spyOn(global, 'fetch').mockRejectedValueOnce('plain');
    await expect(a.find(LE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(new LegalEntityDirectoryHttpAdapter(cfg('', 'k')).find(LE)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('EmployeeLegalEntityPrismaRepository', () => {
  const POINT = {
    id: 'p1',
    employeeId: E1,
    legalEntityId: LE,
    effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
    recordedBy: ACTOR,
    recordedAt: NOW,
  };

  function setup(current: Array<{ employeeId: string; legalEntityId: string }> = []) {
    const tx = {
      employeeLegalEntity: { findMany: jest.fn().mockResolvedValue(current) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ employeeId: E1 }, { employeeId: E2 }]),
    };
    const prisma = {
      employee: { findMany: jest.fn() },
      employeeLegalEntity: { delete: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { prisma, tx, repo: new EmployeeLegalEntityPrismaRepository(prisma as never) };
  }

  it('reads every employee with points as calendar days, and which ids exist', async () => {
    const { prisma, repo } = setup();
    prisma.employee.findMany
      .mockResolvedValueOnce([
        {
          id: E1,
          employeeCode: 'HR-0001',
          fullName: 'Budi',
          position: 'Kasir',
          depotId: null,
          status: 'ACTIVE',
          legalEntities: [POINT],
        },
      ])
      .mockResolvedValueOnce([{ id: E1 }]);
    expect(await repo.histories()).toEqual([
      {
        employeeId: E1,
        employeeCode: 'HR-0001',
        fullName: 'Budi',
        position: 'Kasir',
        depotId: null,
        status: 'ACTIVE',
        points: [{ ...POINT, effectiveFrom: '2026-12-01' }],
      },
    ]);
    expect(await repo.existingEmployeeIds([E1, E2])).toEqual([E1]);
  });

  it('locks each employee-day in order, checks what the screen saw, and upserts in one statement', async () => {
    const { repo, tx } = setup([{ employeeId: E1, legalEntityId: 'old' }]);
    const written = await repo.assign({
      employeeIds: [E2, E1],
      legalEntityId: LE,
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: ACTOR,
      seen: new Map([[E1, 'old']]),
    });
    expect(written).toEqual([
      { employeeId: E1, replaced: 'old' },
      { employeeId: E2, replaced: null },
    ]);
    const lock = tx.$executeRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(lock.strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(lock.values).toEqual([`employee-legal-entity:${E1}:2026-12-01`, `employee-legal-entity:${E2}:2026-12-01`]);
    const sql = tx.$queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('?')).toContain('ON CONFLICT ("employeeId", "effectiveFrom") DO UPDATE');
    expect(sql.values).toEqual([LE, '2026-12-01', ACTOR, E1, E2]);
  });

  it('lets a day that already holds the target through, whatever the screen saw', async () => {
    const { repo, tx } = setup([{ employeeId: E1, legalEntityId: LE }]);
    tx.$queryRaw.mockResolvedValue([]);
    expect(
      await repo.assign({
        employeeIds: [E1],
        legalEntityId: LE,
        effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
        recordedBy: ACTOR,
        seen: new Map(),
      }),
    ).toEqual([]);
  });

  it('refuses when a day holds something the screen did not show, and writes nothing', async () => {
    const { repo, tx } = setup([{ employeeId: E1, legalEntityId: 'theirs' }]);
    const base = {
      employeeIds: [E1],
      legalEntityId: LE,
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: ACTOR,
    };
    await expect(repo.assign({ ...base, seen: new Map() })).rejects.toBeInstanceOf(StaleWriteError);
    await expect(repo.assign({ ...base, seen: new Map([[E1, 'mine']]) })).rejects.toBeInstanceOf(StaleWriteError);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('deletes one point, null when it is gone, and rethrows anything else', async () => {
    const { prisma, repo } = setup();
    const missing = Object.assign(new Error('missing'), { code: 'P2025' });
    prisma.employeeLegalEntity.delete
      .mockResolvedValueOnce(POINT)
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(new Error('db down'));
    prisma.employeeLegalEntity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p1' });
    expect(await repo.remove('p1', LE)).toEqual({ ...POINT, effectiveFrom: '2026-12-01' });
    expect(prisma.employeeLegalEntity.delete).toHaveBeenCalledWith({ where: { id: 'p1', legalEntityId: LE } });
    expect(await repo.remove('p1', LE)).toBeNull();
    await expect(repo.remove('p1', LE)).rejects.toBeInstanceOf(StaleWriteError);
    await expect(repo.remove('p1', LE)).rejects.toThrow('db down');
  });
});
