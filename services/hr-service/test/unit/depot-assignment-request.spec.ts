import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { DepotAssignmentService } from '../../src/application/services/depot-assignment.service';
import { DepotAssignmentController } from '../../src/modules/depot-assignment.controller';
import { RejectDepotRequestDto } from '../../src/modules/dto/depot-assignment.dto';
import { DepotAssignmentPrismaRepository } from '../../src/infrastructure/prisma/depot-assignment.prisma.repository';

const G = '11111111-1111-1111-1111-111111111111'; // the lender
const P = '22222222-2222-2222-2222-222222222222'; // the manager depot
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const emp = {
  id: 'emp-1',
  role: 'STAFF_DEPOT',
  authSubjectId: 'a',
  status: 'ACTIVE',
  depotId: G,
  homeDepotId: G,
  joinDate: day('2026-01-01'),
  exitDate: null,
};
const MANAGER_SUB = '33333333-3333-3333-3333-333333333333';
const manager = { sub: MANAGER_SUB, role: 'MANAGER', depotIds: [P] } as never;
const hr = { sub: '44444444-4444-4444-4444-444444444444', role: 'HR' } as never;
const req = { employeeCode: 'EMP-001', depotId: P, startDate: '2026-10-20', endDate: '2026-10-25' };

function build(row?: Record<string, unknown> | null) {
  const created: Record<string, unknown>[] = [];
  const repo = {
    createChecked: jest.fn(async (data: Record<string, unknown>, check: (o: unknown[]) => void) => {
      check([]);
      created.push(data);
      return { id: 'as-1', ...data };
    }),
    findById: jest.fn(async () => row ?? null),
    decideRequested: jest.fn(async (id: string, to: string, check: ((o: unknown[]) => void) | null) => {
      check?.([]);
      return { id, status: to };
    }),
    list: jest.fn(async () => ({ rows: [], total: 0 })),
  };
  const employees = {
    getById: jest.fn(async () => emp),
    findByCodeInternal: jest.fn(async (code: string) => (code === 'EMP-001' ? emp : null)),
  };
  const svc = new DepotAssignmentService(
    repo as never,
    employees as never,
    { depotAssignmentEnabled: true, timeZone: 'Asia/Jakarta' } as never,
    {} as never,
  );
  return { svc, repo, employees, created };
}
const requested = {
  id: 'as-1',
  employeeId: 'emp-1',
  kind: 'LOAN',
  depotId: P,
  startDate: day('2026-10-20'),
  endDate: day('2026-10-25'),
  status: 'REQUESTED',
};
const msg = (e: { getResponse(): unknown }) => {
  const m = (e.getResponse() as { message: string | string[] }).message;
  return Array.isArray(m) ? m.join(' ') : m;
};

describe('manager requests to borrow', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('writes a REQUESTED row for somebody from another depot', async () => {
    const { svc, created, employees } = build();
    await svc.request(manager, req);
    expect(created[0]).toMatchObject({ status: 'REQUESTED', kind: 'LOAN', employeeId: 'emp-1', depotId: P, createdByRole: 'MANAGER' });
    expect(employees.getById).not.toHaveBeenCalled(); // not the depot-scoped read
  });

  it('only into the requester own depot, only a real employee code, only real days', async () => {
    const { svc, created } = build();
    await expect(svc.request(manager, { ...req, depotId: G })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.request(manager, { ...req, employeeCode: 'NOPE' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.request(manager, { ...req, startDate: '2026-13-40' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(created).toHaveLength(0);
  });

  it('is validated like a plan: a start in the past is refused', async () => {
    const { svc } = build();
    const err = await svc.request(manager, { ...req, startDate: '2026-10-01' }).catch((e) => e);
    expect(msg(err)).toMatch(/lampau/);
  });

  it('HR approves: re-checked under the lock, becomes PLANNED', async () => {
    const { svc, repo } = build(requested);
    await expect(svc.approveRequest(hr, 'as-1')).resolves.toMatchObject({ status: 'PLANNED' });
    expect(repo.decideRequested).toHaveBeenCalledWith('as-1', 'PLANNED', expect.any(Function), {
      failReason: null,
    });
  });

  it('approve and reject need a REQUESTED row and say so', async () => {
    await expect(build({ ...requested, status: 'PLANNED' }).svc.approveRequest(hr, 'as-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(build(null).svc.rejectRequest(hr, 'as-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a decision that lost the race is a 409, and an approval that no longer fits is a 400', async () => {
    const lost = build(requested);
    lost.repo.decideRequested.mockResolvedValueOnce(null as never);
    await expect(lost.svc.approveRequest(hr, 'as-1')).rejects.toBeInstanceOf(ConflictException);
    const late = build({ ...requested, startDate: day('2026-10-01') });
    await expect(late.svc.approveRequest(hr, 'as-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reject records the reason and demands one', async () => {
    const { svc, repo } = build(requested);
    await expect(svc.rejectRequest(hr, 'as-1', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await svc.rejectRequest(hr, 'as-1', 'stok orang kurang');
    expect(repo.decideRequested).toHaveBeenCalledWith('as-1', 'CANCELLED', null, {
      failReason: 'stok orang kurang',
    });
    const lost = build(requested);
    lost.repo.decideRequested.mockResolvedValueOnce(null as never);
    await expect(lost.svc.rejectRequest(hr, 'as-1', 'x')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a repository without the capability refuses to decide', async () => {
    const { svc, repo } = build(requested);
    delete (repo as Record<string, unknown>).decideRequested;
    await expect(svc.rejectRequest(hr, 'as-1', 'x')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a manager reads back only their own requests, bounded', async () => {
    const { svc, repo } = build();
    await svc.myRequests(manager, { page: 2, pageSize: 500 });
    expect(repo.list).toHaveBeenCalledWith({ createdBy: MANAGER_SUB, skip: 100, take: 100 });
    await svc.myRequests(manager, {});
    expect(repo.list).toHaveBeenLastCalledWith({ createdBy: MANAGER_SUB, skip: 0, take: 20 });
  });
});

describe('request routes', () => {
  it('hand the body and the caller to the service', async () => {
    const s = {
      request: jest.fn().mockResolvedValue('r'),
      myRequests: jest.fn().mockResolvedValue('m'),
      approveRequest: jest.fn().mockResolvedValue('a'),
      rejectRequest: jest.fn().mockResolvedValue('j'),
    };
    const c = new DepotAssignmentController(s as never);
    await c.request(req as never, manager);
    await c.myRequests({} as never, manager);
    await c.approve('as-1', hr);
    const dto = plainToInstance(RejectDepotRequestDto, { reason: 'x' });
    await c.reject('as-1', dto, hr);
    expect(s.request).toHaveBeenCalledWith(manager, req);
    expect(s.rejectRequest).toHaveBeenCalledWith(hr, 'as-1', 'x');
    expect(s.approveRequest).toHaveBeenCalledWith(hr, 'as-1');
  });
});

describe('DepotAssignmentPrismaRepository.decideRequested', () => {
  function buildRepo(row: { status: string; employeeId: string } | null, count = 1) {
    const tx = {
      employeeDepotAssignment: {
        findUnique: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    return { tx, repo: new DepotAssignmentPrismaRepository(prisma as never) };
  }
  const row = { status: 'REQUESTED', employeeId: 'emp-1' };

  it('locks the employee, runs the check, then flips status with a guard', async () => {
    const { tx, repo } = buildRepo(row);
    const check = jest.fn();
    await repo.decideRequested!('as-1', 'PLANNED', check, { failReason: null });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith([]);
    expect(tx.employeeDepotAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 'as-1', status: 'REQUESTED' },
      data: { status: 'PLANNED', failReason: null },
    });
  });

  it('a row already decided, or a lost race, returns null; no failReason leaves it alone', async () => {
    await expect(buildRepo(null).repo.decideRequested!('x', 'CANCELLED', null, {})).resolves.toBeNull();
    await expect(
      buildRepo({ ...row, status: 'PLANNED' }).repo.decideRequested!('x', 'CANCELLED', null, {}),
    ).resolves.toBeNull();
    const lost = buildRepo(row, 0);
    await expect(lost.repo.decideRequested!('x', 'CANCELLED', null, {})).resolves.toBeNull();
    expect(lost.tx.employeeDepotAssignment.updateMany.mock.calls[0][0].data).toEqual({ status: 'CANCELLED' });
  });
});
