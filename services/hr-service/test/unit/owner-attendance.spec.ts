import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { AttendanceService } from '../../src/application/services/attendance.service';
import { OwnerAttendanceService } from '../../src/application/services/owner-attendance.service';
import type {
  AttendanceListFilter,
  AttendanceRepository,
} from '../../src/application/ports/attendance.repository';
import type { DepotDirectoryPort } from '../../src/application/ports/depot-directory.port';
import type { OwnedDepotsPort } from '../../src/application/ports/owned-depots.port';
import { OwnedDepotsHttpAdapter } from '../../src/infrastructure/http/owned-depots.http.adapter';
import { AttendancePrismaRepository } from '../../src/infrastructure/prisma/attendance.prisma.repository';
import { OwnerAttendanceController } from '../../src/modules/owner-attendance.controller';
import type { HrConfigService } from '../../src/config/hr-config.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const owner = { sub: 'owner-1', role: 'FRANCHISE_OWNER' } as AuthenticatedUser;

function setup(owned: string[] = [A, B]) {
  const list = jest.fn(async (_f: AttendanceListFilter) => ({ rows: [{ id: 'r1' }], total: 1 }));
  const summaryByDepot = jest.fn(async () => [
    { depotId: A, present: 5, late: 2, absent: 1, leave: 0, holiday: 0, pending: 1, lateMinutes: 40, employees: 6 },
  ]);
  const repo = { list, summaryByDepot } as unknown as AttendanceRepository;
  const ports: OwnedDepotsPort = { depotIdsOf: jest.fn(async () => owned) };
  const directory: DepotDirectoryPort = {
    isActive: async () => true,
    names: async () => new Map([[A, 'Depot A']]),
  };
  const attendance = { photoForDepots: jest.fn(async () => ({ body: Buffer.from('x'), contentType: 'image/jpeg' })) };
  const service = new OwnerAttendanceService(repo, ports, directory, attendance as unknown as AttendanceService);
  return { service, list, summaryByDepot, ports, attendance };
}

describe('OwnerAttendanceService', () => {
  it('asks depot-service which depots the caller owns, on every call', async () => {
    const { service, ports } = setup();
    await service.list(owner, { page: 1, pageSize: 10 });
    await service.list(owner, { page: 1, pageSize: 10 });
    expect(ports.depotIdsOf).toHaveBeenCalledTimes(2);
    expect(ports.depotIdsOf).toHaveBeenCalledWith('owner-1');
  });

  it('lists only the owned depots, and narrows to one that is owned', async () => {
    const { service, list } = setup();
    await service.list(owner, { page: 2, pageSize: 10, status: 'LATE', from: '2026-10-01', to: '2026-10-31', employeeId: 'e1' });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ depotIds: [A, B], status: 'LATE', skip: 10, take: 10, employeeId: 'e1' });
    await service.list(owner, { depotId: B, page: 1, pageSize: 10 });
    expect(list.mock.calls[1]?.[0]).toMatchObject({ depotIds: [B], from: undefined, to: undefined });
  });

  it('refuses a depot the owner does not own, and never reaches the repository', async () => {
    const { service, list } = setup();
    await expect(service.list(owner, { depotId: FOREIGN, page: 1, pageSize: 10 })).rejects.toThrow(ForbiddenException);
    await expect(service.summary(owner, { depotId: FOREIGN, from: '2026-10-01', to: '2026-10-31' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('an owner with no depots gets nothing, never an unfiltered list', async () => {
    const { service, list, summaryByDepot } = setup([]);
    expect(await service.list(owner, { page: 1, pageSize: 10 })).toEqual({ rows: [], total: 0, page: 1, pageSize: 10 });
    expect(await service.summary(owner, { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      depots: [],
    });
    expect(list).not.toHaveBeenCalled();
    expect(summaryByDepot).not.toHaveBeenCalled();
  });

  it('a failed ownership lookup fails the request instead of widening or emptying it', async () => {
    const { service, ports } = setup();
    (ports.depotIdsOf as jest.Mock).mockRejectedValueOnce(new ServiceUnavailableException('down'));
    await expect(service.list(owner, { page: 1, pageSize: 10 })).rejects.toThrow(ServiceUnavailableException);
  });

  it('the summary lists EVERY owned depot, zero-filled where there were no rows, with names', async () => {
    const { service } = setup();
    const out = await service.summary(owner, { from: '2026-10-01', to: '2026-10-31' });
    expect(out.depots.map((d) => d.depotId)).toEqual([A, B]);
    expect(out.depots[0]).toMatchObject({ depotName: 'Depot A', present: 5, late: 2, lateMinutes: 40, employees: 6 });
    expect(out.depots[1]).toMatchObject({ depotName: null, present: 0, late: 0, employees: 0 });
  });

  it('names the owned depots', async () => {
    const { service } = setup();
    expect(await service.depots(owner)).toEqual([
      { id: A, name: 'Depot A' },
      { id: B, name: null },
    ]);
  });

  it('reads the photo against the owned depots', async () => {
    const { service, attendance } = setup();
    await service.photo(owner, 'row-1', 'in');
    expect(attendance.photoForDepots).toHaveBeenCalledWith([A, B], 'row-1', 'in');
  });
});

describe('AttendanceService.photoForDepots', () => {
  function make(depotId: string | null, opts: { row?: boolean; employee?: boolean; assign?: boolean; rowDepot?: string | null } = {}) {
    const row = opts.row === false ? null : { id: 'r1', employeeId: 'e1', depotId: opts.rowDepot ?? null, checkInPhotoUrl: 'hr/attendance/in.jpg', checkOutPhotoUrl: null };
    const repo = { findById: async () => row } as unknown as AttendanceRepository;
    const employees = {
      findById: async () => (opts.employee === false ? null : { id: 'e1', depotId }),
    };
    const storage = { getObject: jest.fn(async () => ({ body: Buffer.from('img'), contentType: undefined })) };
    const config = { depotAssignmentEnabled: opts.assign ?? false } as unknown as HrConfigService;
    const svc = new AttendanceService(
      repo,
      {} as never,
      {} as never,
      employees as never,
      config,
      storage as never,
    );
    return { svc, storage };
  }

  it('returns the frame for a day at an owned depot', async () => {
    const { svc, storage } = make(A);
    const out = await svc.photoForDepots([A], 'r1', 'in');
    expect(out.contentType).toBe('image/jpeg');
    expect(storage.getObject).toHaveBeenCalled();
  });

  it('answers 404, not 403, for a depot that is not owned, and for no depot at all', async () => {
    const { svc, storage } = make(FOREIGN);
    await expect(svc.photoForDepots([A], 'r1', 'in')).rejects.toThrow(NotFoundException);
    await expect(make(null).svc.photoForDepots([A], 'r1', 'in')).rejects.toThrow(NotFoundException);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('with depot assignment on, the depot the day was WORKED at decides', async () => {
    // The employee lives at a foreign depot but worked this day at an owned one.
    const lent = make(FOREIGN, { assign: true, rowDepot: A });
    await expect(lent.svc.photoForDepots([A], 'r1', 'in')).resolves.toBeDefined();
    // Off: the live depot decides, so the same row is refused.
    const off = make(FOREIGN, { assign: false, rowDepot: A });
    await expect(off.svc.photoForDepots([A], 'r1', 'in')).rejects.toThrow(NotFoundException);
  });

  it('a missing row or employee is a 404 before any access decision', async () => {
    await expect(make(A, { row: false }).svc.photoForDepots([A], 'r1', 'in')).rejects.toThrow(NotFoundException);
    await expect(make(A, { employee: false }).svc.photoForDepots([A], 'r1', 'in')).rejects.toThrow(NotFoundException);
  });
});

describe('OwnedDepotsHttpAdapter', () => {
  const cfg = (url?: string, key?: string) => ({ depotService: { url, internalKey: key } }) as unknown as HrConfigService;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('reads the owned ids with the internal key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ depotIds: [A, 7, B] }) });
    const ids = await new OwnedDepotsHttpAdapter(cfg('http://depot:3007/', 'k')).depotIdsOf('o 1');
    expect(ids).toEqual([A, B]);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://depot:3007/api/v1/depots/internal/owned/o%201');
    expect(init.headers['x-internal-key']).toBe('k');
  });

  it('fails closed on every way the answer can be missing or wrong', async () => {
    await expect(new OwnedDepotsHttpAdapter(cfg(undefined, 'k')).depotIdsOf('o')).rejects.toThrow(ServiceUnavailableException);
    await expect(new OwnedDepotsHttpAdapter(cfg('http://d', undefined)).depotIdsOf('o')).rejects.toThrow(ServiceUnavailableException);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(new OwnedDepotsHttpAdapter(cfg('http://d', 'k')).depotIdsOf('o')).rejects.toThrow('tidak terjangkau');
    fetchMock.mockRejectedValueOnce('boom');
    await expect(new OwnedDepotsHttpAdapter(cfg('http://d', 'k')).depotIdsOf('o')).rejects.toThrow('unknown');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(new OwnedDepotsHttpAdapter(cfg('http://d', 'k')).depotIdsOf('o')).rejects.toThrow('500');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ depotIds: 'nope' }) });
    await expect(new OwnedDepotsHttpAdapter(cfg('http://d', 'k')).depotIdsOf('o')).rejects.toThrow('bentuk');
  });
});

describe('AttendancePrismaRepository.summaryByDepot', () => {
  it('folds the grouped counts into one row per depot, with distinct people', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { depotId: A, status: 'PRESENT', _count: { _all: 4 }, _sum: { lateMinutes: 0 } },
        { depotId: A, status: 'LATE', _count: { _all: 2 }, _sum: { lateMinutes: 35 } },
        { depotId: A, status: 'ABSENT', _count: { _all: 1 }, _sum: { lateMinutes: null } },
        { depotId: A, status: 'LEAVE', _count: { _all: 3 }, _sum: { lateMinutes: 0 } },
        { depotId: A, status: 'HOLIDAY', _count: { _all: 2 }, _sum: { lateMinutes: 0 } },
        { depotId: A, status: 'PENDING', _count: { _all: 1 }, _sum: { lateMinutes: 0 } },
        { depotId: B, status: 'LATE', _count: { _all: 1 }, _sum: { lateMinutes: null } },
      ])
      .mockResolvedValueOnce([
        { depotId: A, employeeId: 'e1' },
        { depotId: A, employeeId: 'e2' },
        { depotId: B, employeeId: 'e3' },
      ]);
    const repo = new AttendancePrismaRepository({ attendance: { groupBy } } as never);
    const out = await repo.summaryByDepot([A, B], new Date('2026-10-01'), new Date('2026-10-31'));
    expect(out).toEqual([
      { depotId: A, present: 4, late: 2, absent: 1, leave: 3, holiday: 2, pending: 1, lateMinutes: 35, employees: 2 },
      { depotId: B, present: 0, late: 1, absent: 0, leave: 0, holiday: 0, pending: 0, lateMinutes: 0, employees: 1 },
    ]);
    expect(groupBy.mock.calls[0]?.[0].where.depotId).toEqual({ in: [A, B] });
  });

  it('asks nothing when there are no depots', async () => {
    const groupBy = jest.fn();
    const repo = new AttendancePrismaRepository({ attendance: { groupBy } } as never);
    expect(await repo.summaryByDepot([], new Date(), new Date())).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

describe('OwnerAttendanceController', () => {
  it('delegates each route to the service and refuses a photo side that does not exist', async () => {
    const svc = {
      depots: jest.fn().mockResolvedValue([]),
      summary: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({}),
      photo: jest.fn().mockResolvedValue({ body: Buffer.from('x'), contentType: 'image/png' }),
    };
    const c = new OwnerAttendanceController(svc as never);
    await c.depots(owner);
    await c.summary({ from: 'a', to: 'b' }, owner);
    await c.list({ page: 1, pageSize: 5 } as never, owner);
    expect(svc.summary).toHaveBeenCalledWith(owner, { from: 'a', to: 'b' });
    const res = { setHeader: jest.fn() };
    await c.photo(A, 'out', owner, res as never);
    expect(svc.photo).toHaveBeenCalledWith(owner, A, 'out');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    await expect(c.photo(A, 'sideways', owner, res as never)).rejects.toThrow(BadRequestException);
  });
});
