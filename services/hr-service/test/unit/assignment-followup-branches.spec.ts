import { AttendanceService } from '../../src/application/services/attendance.service';
import { DepotAssignmentService } from '../../src/application/services/depot-assignment.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { DepotAssignmentPrismaRepository } from '../../src/infrastructure/prisma/depot-assignment.prisma.repository';

const DEPOT = '11111111-1111-1111-1111-111111111111';
const hr = { sub: 'hr-1', role: 'HR' } as never;
const config = { timeZone: 'Asia/Jakarta', depotAssignmentEnabled: true } as never;

describe('history import defaults', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('a LATE day with no minutes given books 0 late minutes', async () => {
    const repo = {
      findByEmployeeAndDate: async () => null,
      upsertManual: jest.fn(async (i: Record<string, unknown>) => ({ id: 'a1', ...i })),
      recordAdjustment: async () => undefined,
    };
    const employees = { findByEmployeeCode: async () => ({ id: 'e1', depotId: DEPOT, homeDepotId: DEPOT }) };
    const svc = new AttendanceService(repo as never, {} as never, {} as never, employees as never, config);
    await svc.importHistory(hr, [{ employeeCode: 'E-1', workDate: '2026-09-01', status: 'LATE' }]);
    expect(repo.upsertManual).toHaveBeenCalledWith(expect.objectContaining({ lateMinutes: 0 }));
  });

  it('a slip with no present days given carries a share of 0 days', async () => {
    const repo = {
      findByEmployeeAndPeriod: async () => null,
      create: jest.fn(async (d: Record<string, unknown>) => ({ id: 'p1', ...d })),
      setStatus: async (id: string) => ({ id }),
    };
    const employees = { getByCode: async () => ({ id: 'e1', depotId: DEPOT, homeDepotId: DEPOT }) };
    const svc = new PayrollService(repo as never, {} as never, {} as never, {} as never, employees as never, config);
    await svc.importHistory(hr, [{ employeeCode: 'E-1', periodMonth: '2026-08', gross: 500 }]);
    expect((repo.create.mock.calls[0][0] as { shares: { days: number }[] }).shares[0].days).toBe(0);
  });
});

describe('approving a request with no end date still reads the row', () => {
  it('passes a null end through to the re-check', async () => {
    const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
    const row = {
      id: 'as-1',
      employeeId: 'e1',
      kind: 'PERMANENT',
      depotId: DEPOT,
      startDate: day('2026-10-20'),
      endDate: null,
      status: 'REQUESTED',
    };
    const repo = {
      findById: async () => row,
      decideRequested: jest.fn(async (id: string, to: string, check: ((o: unknown[]) => void) | null) => {
        check?.([]);
        return { id, status: to };
      }),
    };
    const employees = {
      getById: async () => ({
        id: 'e1', role: 'STAFF_DEPOT', authSubjectId: 'a', status: 'ACTIVE', depotId: '2'.repeat(8) + '-2222-2222-2222-222222222222',
        homeDepotId: '2'.repeat(8) + '-2222-2222-2222-222222222222', joinDate: day('2026-01-01'), exitDate: null,
      }),
    };
    jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') });
    const svc = new DepotAssignmentService(repo as never, employees as never, config, {} as never);
    await expect(svc.approveRequest(hr, 'as-1')).resolves.toMatchObject({ status: 'PLANNED' });
    jest.useRealTimers();
  });
});

describe('DepotAssignmentPrismaRepository follow-up filters', () => {
  it('writes a REQUESTED status when asked and filters a list by its creator', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'x', ...data }));
    const tx = {
      $queryRaw: async () => [],
      employeeDepotAssignment: { findMany: async () => [], create },
    };
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      $transaction: async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as unknown[]),
      employeeDepotAssignment: { findMany, count: jest.fn().mockResolvedValue(0) },
    };
    const repo = new DepotAssignmentPrismaRepository(prisma as never);
    await repo.createChecked(
      { employeeId: 'e1', kind: 'LOAN', depotId: DEPOT, startDate: '2026-10-20', endDate: '2026-10-25', createdByRole: 'MANAGER', createdBy: null, note: null, status: 'REQUESTED' },
      () => undefined,
    );
    expect(create.mock.calls[0][0].data.status).toBe('REQUESTED');
    await repo.list({ createdBy: 'u1', skip: 0, take: 10 });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ createdBy: 'u1' });
  });
});
