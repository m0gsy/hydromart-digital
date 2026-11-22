import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import {
  AssignEmployeesData,
  AssignedEmployee,
  EmployeeLegalEntityRepository,
} from '../../src/application/ports/employee-legal-entity.repository';
import { LegalEntityDirectoryPort, LegalEntitySummary } from '../../src/application/ports/legal-entity-directory.port';
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
const NOW = new Date('2026-11-22T03:00:00.000Z');

/** The Prisma repository's rules in memory: one point per employee per day, a same-day write corrects it. */
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
    const out: AssignedEmployee[] = [];
    for (const employeeId of data.employeeIds) {
      const at = this.points.find((p) => p.employeeId === employeeId && p.effectiveFrom === day);
      if (at?.legalEntityId === data.legalEntityId) continue;
      out.push({ employeeId, replaced: at?.legalEntityId ?? null });
      if (at) at.legalEntityId = data.legalEntityId;
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
  async remove(id: string): Promise<EmployeeLegalEntityPoint | null> {
    const found = this.points.find((p) => p.id === id) ?? null;
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
  let controller: EmployeeLegalEntityController;
  const user = { sub: ACTOR, role: 'HEAD_OFFICE' } as unknown as AuthenticatedUser;

  beforeEach(() => {
    points = new FakePoints();
    directory = new FakeDirectory();
    controller = new EmployeeLegalEntityController(new EmployeeLegalEntityService(points, directory));
  });

  it('dates employees to an entity, leaves an unchanged day alone, and corrects a day', async () => {
    const body = { employeeIds: [E1, E1, E2], legalEntityId: LE, effectiveFrom: '2026-12-01' };
    expect(await controller.assign(body, user)).toEqual([
      { employeeId: E1, replaced: null },
      { employeeId: E2, replaced: null },
    ]);
    expect(await controller.assign(body, user)).toEqual([]);
    const other = '55555555-5555-4555-8555-555555555555';
    directory.known.set(other, { id: other, name: 'PT Indo', kind: 'FRANCHISOR', active: true });
    expect(await controller.assign({ ...body, employeeIds: [E1], legalEntityId: other }, user)).toEqual([
      { employeeId: E1, replaced: LE },
    ]);
    const histories = await controller.histories();
    expect(histories[0].points).toEqual([expect.objectContaining({ legalEntityId: other, recordedBy: ACTOR })]);
  });

  it('refuses a day that is not one, an unknown or switched-off entity, and an unknown employee', async () => {
    const body = { employeeIds: [E1], legalEntityId: LE, effectiveFrom: '2026-02-30' };
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
  });

  it('takes back one point, and is 404 for one that is gone', async () => {
    await controller.assign({ employeeIds: [E1], legalEntityId: LE, effectiveFrom: '2026-12-01' }, user);
    await expect(controller.remove('p0')).resolves.toBeUndefined();
    await expect(controller.remove('p0')).rejects.toBeInstanceOf(NotFoundException);
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

  function setup() {
    const tx = {
      employeeLegalEntity: { findMany: jest.fn().mockResolvedValue([{ employeeId: E1, legalEntityId: 'old' }]) },
      $queryRaw: jest.fn().mockResolvedValue([{ employeeId: E1 }, { employeeId: E2 }]),
    };
    const prisma = {
      employee: { findMany: jest.fn() },
      employeeLegalEntity: { delete: jest.fn() },
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

  it('upserts in one statement and names what a corrected day held', async () => {
    const { repo, tx } = setup();
    const written = await repo.assign({
      employeeIds: [E1, E2],
      legalEntityId: LE,
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: ACTOR,
    });
    expect(written).toEqual([
      { employeeId: E1, replaced: 'old' },
      { employeeId: E2, replaced: null },
    ]);
    const sql = tx.$queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('?')).toContain('ON CONFLICT ("employeeId", "effectiveFrom") DO UPDATE');
    expect(sql.values).toEqual(expect.arrayContaining([LE, '2026-12-01', ACTOR, E1, E2]));
  });

  it('deletes one point, null when it is gone, and rethrows anything else', async () => {
    const { prisma, repo } = setup();
    prisma.employeeLegalEntity.delete
      .mockResolvedValueOnce(POINT)
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'P2025' }))
      .mockRejectedValueOnce(new Error('db down'));
    expect(await repo.remove('p1')).toEqual({ ...POINT, effectiveFrom: '2026-12-01' });
    expect(await repo.remove('p1')).toBeNull();
    await expect(repo.remove('p1')).rejects.toThrow('db down');
  });
});
