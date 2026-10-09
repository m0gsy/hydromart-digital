import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee } from '../../prisma/generated/client';
import { audienceMatches } from '../../src/domain/announcement';
import { homeDepotOf } from '../../src/domain/depot-on';
import { redactForLendingDepot } from '../../src/domain/employee-redaction';
import { AnnouncementPrismaRepository } from '../../src/infrastructure/prisma/announcement.prisma.repository';
import { AssetService } from '../../src/application/services/asset.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { LeaveService } from '../../src/application/services/leave.service';
import { fakeIdentity } from './support/identity';

const HOME = '11111111-1111-1111-1111-111111111111';
const AWAY = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';

const manager = (depotId: string): AuthenticatedUser =>
  ({ sub: 'm', role: 'MANAGER' as never, phone: null, depotId, depotIds: [depotId] }) as AuthenticatedUser;
const hq: AuthenticatedUser = { sub: 'hq', role: 'HR' as never, phone: null, depotId: null };

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    employeeCode: 'HR-0001',
    fullName: 'Budi',
    phone: '0811',
    position: 'Kurir',
    role: 'STAFF_DEPOT',
    status: 'ACTIVE',
    authSubjectId: 'acct-1',
    depotId: AWAY, // lent to AWAY
    homeDepotId: HOME,
    departmentId: null,
    nik: '3201',
    npwp: '09.1',
    bpjsKes: 'k',
    bpjsTk: 't',
    bankName: 'BCA',
    bankAccount: '123',
    dailyRate: 150000,
    monthlyRate: null,
    birthDate: new Date('1990-01-01T00:00:00.000Z'),
    gender: 'MALE',
    address: 'Jl. Mawar',
    ptkpStatus: 'TK0',
    emergencyName: 'Ibu',
    emergencyPhone: '0812',
    contractEndDate: new Date('2027-01-01T00:00:00.000Z'),
    email: 'b@x.id',
    joinDate: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as unknown as Employee;
}

describe('redactForLendingDepot', () => {
  it('blanks pay and papers, keeps what running a day needs, and does not touch the original', () => {
    const e = employee();
    const r = redactForLendingDepot(e);
    for (const f of ['nik', 'npwp', 'bpjsKes', 'bpjsTk', 'bankName', 'bankAccount', 'dailyRate', 'monthlyRate', 'birthDate', 'gender', 'address', 'ptkpStatus', 'emergencyName', 'emergencyPhone', 'contractEndDate', 'email']) {
      expect((r as unknown as Record<string, unknown>)[f]).toBeNull();
    }
    expect(r).toMatchObject({ id: 'emp-1', fullName: 'Budi', phone: '0811', employeeCode: 'HR-0001', position: 'Kurir', depotId: AWAY });
    expect(e.nik).toBe('3201');
  });
});

describe('homeDepotOf', () => {
  it('is the home column, falling back to the live depot for rows that predate it', () => {
    expect(homeDepotOf({ homeDepotId: HOME, depotId: AWAY })).toBe(HOME);
    expect(homeDepotOf({ homeDepotId: null, depotId: AWAY })).toBe(AWAY);
    expect(homeDepotOf({ homeDepotId: null, depotId: null })).toBeNull();
  });
});

describe('EmployeeService dual access', () => {
  function make(row: Employee) {
    const repo = {
      findById: async (id: string) => (id === row.id ? row : null),
      list: async () => ({ rows: [row, employee({ id: 'e2', depotId: HOME, homeDepotId: HOME })], total: 2 }),
      update: jest.fn(async () => row),
    };
    return { repo, svc: new EmployeeService(repo as never, fakeIdentity()) };
  }

  it('the home depot sees the whole row; head office too', async () => {
    const { svc } = make(employee());
    await expect(svc.getById(manager(HOME), 'emp-1')).resolves.toMatchObject({ nik: '3201', dailyRate: 150000 });
    await expect(svc.getById(hq, 'emp-1')).resolves.toMatchObject({ nik: '3201' });
  });

  it('the depot the person is lent to sees them without pay and papers', async () => {
    const { svc } = make(employee());
    const seen = await svc.getById(manager(AWAY), 'emp-1');
    expect(seen).toMatchObject({ fullName: 'Budi', phone: '0811', nik: null, dailyRate: null, bankAccount: null });
  });

  it('a depot that is neither is refused, as before', async () => {
    const { svc } = make(employee());
    await expect(svc.getById(manager(OTHER), 'emp-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('someone who is not lent out is unchanged: one depot, full row', async () => {
    const { svc } = make(employee({ depotId: HOME, homeDepotId: HOME }));
    await expect(svc.getById(manager(HOME), 'emp-1')).resolves.toMatchObject({ nik: '3201' });
    await expect(svc.getById(manager(AWAY), 'emp-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a row that predates the home column behaves by its live depot', async () => {
    const { svc } = make(employee({ depotId: HOME, homeDepotId: null }));
    await expect(svc.getById(manager(HOME), 'emp-1')).resolves.toMatchObject({ nik: '3201' });
  });

  it('the borrowing depot cannot edit the record, and cannot mint its login', async () => {
    const { svc, repo } = make(employee());
    await expect(svc.update(manager(AWAY), 'emp-1', { fullName: 'Hacked' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createAccountFor(manager(AWAY), 'emp-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('the list blanks only the rows the caller merely borrows', async () => {
    const { svc } = make(employee());
    const { rows } = await svc.list(manager(AWAY), { page: 1, pageSize: 20 });
    expect(rows[0]).toMatchObject({ id: 'emp-1', nik: null });
    // The second row belongs to HOME, which this caller does not reach at all - but the repo
    // fake ignores scope; the point is that a row the caller DOES own stays whole.
    const mine = await svc.list(manager(HOME), { page: 1, pageSize: 20 });
    expect(mine.rows.find((r) => r.id === 'e2')).toMatchObject({ nik: '3201' });
    expect(mine.rows.find((r) => r.id === 'emp-1')).toMatchObject({ nik: '3201' });
  });
});

describe('announcements reach a lent employee at both depots', () => {
  const emp = { id: 'e', depotId: AWAY, homeDepotId: HOME, departmentId: null, position: 'Kurir' };
  it('a notice for the home depot or the work depot covers them; another depot does not', () => {
    expect(audienceMatches([{ dimension: 'DEPOT', value: HOME }], emp)).toBe(true);
    expect(audienceMatches([{ dimension: 'DEPOT', value: AWAY }], emp)).toBe(true);
    expect(audienceMatches([{ dimension: 'DEPOT', value: OTHER }], emp)).toBe(false);
    expect(audienceMatches([{ dimension: 'DEPOT', value: null }], emp)).toBe(false);
  });

  it('the feed query asks for both depots, and only one when they are the same', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new AnnouncementPrismaRepository({ announcement: { findMany } } as never);
    const audience = { employeeId: 'e', departmentId: null, position: 'Kurir' };
    await repo.listFeedFor({ ...audience, depotId: AWAY, homeDepotId: HOME }, 10);
    const depotTargets = (call: number) =>
      findMany.mock.calls[call][0].where.targets.some.OR.filter((o: { dimension: string }) => o.dimension === 'DEPOT').map((o: { value: string }) => o.value);
    expect(depotTargets(0)).toEqual([AWAY, HOME]);
    await repo.listFeedFor({ ...audience, depotId: HOME, homeDepotId: HOME }, 10);
    expect(depotTargets(1)).toEqual([HOME]);
  });
});

describe('leave rules follow the home depot', () => {
  it('working days and quota are asked of the home depot while the request is stamped with the work depot', async () => {
    const weeklyOff = jest.fn((_depot: string | null) => '0');
    const quota = jest.fn((_depot: string | null) => 12);
    const listDates = jest.fn(async (_depot: string | null, _from: Date, _to: Date) => [] as string[]);
    const created: Record<string, unknown>[] = [];
    const repo = {
      listBlocking: async () => [],
      ensureBalance: async () => ({ usedDays: 0, quotaDays: 12 }),
      create: async (r: Record<string, unknown>) => (created.push(r), { id: 'l1', ...r }),
    };
    const config = { weeklyOffDays: weeklyOff, annualLeaveQuotaDays: quota, timeZone: 'Asia/Jakarta' };
    const svc = new LeaveService(
      repo as never,
      {} as never,
      { getSelf: async () => employee() } as never,
      config as never,
      { listDates } as never,
      { notify: async () => undefined } as never,
      { assistantOfDepot: async () => null } as never,
    );
    await svc.submit({ sub: 'acct-1', role: 'STAFF_DEPOT' as never, phone: null, depotId: AWAY }, {
      type: 'ANNUAL',
      startDate: '2026-07-06',
      endDate: '2026-07-08',
      reason: 'x',
    }).catch(() => undefined);
    expect(listDates.mock.calls[0][0]).toBe(HOME);
    expect(weeklyOff.mock.calls[0][0]).toBe(HOME);
    expect(quota.mock.calls[0][0]).toBe(HOME);
    expect(created[0]).toMatchObject({ depotId: AWAY });
  });
});

describe('asset handover to a lent employee', () => {
  function make(assetDepot: string) {
    const asset = { id: 'a1', depotId: assetDepot, status: 'AVAILABLE', holderId: null };
    const repo = { findById: async () => asset, move: jest.fn(async () => asset) };
    const employees = { getById: async () => employee() };
    return { repo, svc: new AssetService(repo as never, employees as never) };
  }
  it('allows an asset of the home depot or of the work depot, refuses a third depot', async () => {
    const input = { kind: 'ASSIGN', toEmployeeId: 'emp-1' } as never;
    await expect(make(HOME).svc.move(hq, 'a1', input)).resolves.toBeDefined();
    await expect(make(AWAY).svc.move(hq, 'a1', input)).resolves.toBeDefined();
    await expect(make(OTHER).svc.move(hq, 'a1', input)).rejects.toThrow(/depot lain/);
  });
});
