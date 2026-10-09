import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, EmployeeDepotAssignment } from '../../prisma/generated/client';
import {
  DepotAssignmentRepository,
  DepotAssignmentWrite,
} from '../../src/application/ports/depot-assignment.repository';
import { DepotAssignmentService } from '../../src/application/services/depot-assignment.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { HrConfigService } from '../../src/config/hr-config.service';
import { DepotAssignmentController } from '../../src/modules/depot-assignment.controller';
import { DepotAssignmentPrismaRepository } from '../../src/infrastructure/prisma/depot-assignment.prisma.repository';
import { envValidationSchema } from '../../src/config/env.validation';
import { fakeIdentity } from './support/identity';

const GALAKSI = '11111111-1111-1111-1111-111111111111';
const PEKAYON = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = {
  sub: '99999999-9999-9999-9999-999999999999',
  role: 'HR' as never,
  phone: null,
  depotId: null,
};

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    role: 'STAFF_DEPOT',
    authSubjectId: 'acct-1',
    status: 'ACTIVE',
    depotId: GALAKSI,
    homeDepotId: GALAKSI,
    joinDate: day('2026-01-01'),
    exitDate: null,
    ...over,
  } as Employee;
}

class FakeAssignments implements DepotAssignmentRepository {
  rows: EmployeeDepotAssignment[] = [];
  created: DepotAssignmentWrite[] = [];
  raceOnCancel = false;
  async createChecked(data: DepotAssignmentWrite, check: (o: EmployeeDepotAssignment[]) => void) {
    check(this.rows.filter((r) => r.status === 'PLANNED' || r.status === 'ACTIVE'));
    this.created.push(data);
    const row = {
      id: `as-${this.rows.length + 1}`,
      ...data,
      startDate: day(data.startDate),
      endDate: data.endDate ? day(data.endDate) : null,
      status: 'PLANNED',
    } as unknown as EmployeeDepotAssignment;
    this.rows.push(row);
    return row;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async hasOpen() {
    return this.rows.some((r) => r.status === 'PLANNED' || r.status === 'ACTIVE');
  }
  async list() {
    return { rows: this.rows, total: this.rows.length };
  }
  async cancelPlanned(id: string) {
    if (this.raceOnCancel) return null;
    const row = this.rows.find((r) => r.id === id && r.status === 'PLANNED');
    if (!row) return null;
    row.status = 'CANCELLED';
    return row;
  }
}

function make(opts: { enabled?: boolean; emp?: Employee | null; today?: string } = {}) {
  const repo = new FakeAssignments();
  const emp = opts.emp === undefined ? employee() : opts.emp;
  const employees = {
    getById: jest.fn(async () => {
      if (!emp) throw new NotFoundException('Karyawan tidak ditemukan');
      return emp;
    }),
  } as unknown as EmployeeService;
  const config = {
    depotAssignmentEnabled: opts.enabled ?? true,
    timeZone: 'Asia/Jakarta',
  } as HrConfigService;
  jest.useFakeTimers({ now: new Date(`${opts.today ?? '2026-10-10'}T03:00:00.000Z`) });
  return { repo, employees, svc: new DepotAssignmentService(repo, employees, config) };
}

afterEach(() => jest.useRealTimers());

const loan = {
  employeeId: 'emp-1',
  kind: 'LOAN' as const,
  depotId: PEKAYON,
  startDate: '2026-10-16',
  endDate: '2026-10-25',
};

describe('DepotAssignmentService', () => {
  it('is dark while the flag is off: every route answers 404 and nothing is read', async () => {
    const { svc, employees } = make({ enabled: false });
    await expect(svc.plan(hr, loan)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.cancel(hr, 'as-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.list(hr, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(employees.getById).not.toHaveBeenCalled();
  });

  it('plans a valid loan and records who asked', async () => {
    const { svc, repo } = make();
    const row = await svc.plan(hr, loan);
    expect(row.status).toBe('PLANNED');
    expect(repo.created[0]).toMatchObject({
      employeeId: 'emp-1',
      kind: 'LOAN',
      depotId: PEKAYON,
      startDate: '2026-10-16',
      endDate: '2026-10-25',
      createdByRole: 'HR',
      createdBy: hr.sub,
    });
  });

  it('records a non-uuid actor (the internal system principal) as null', async () => {
    const { svc, repo } = make();
    await svc.plan({ ...hr, sub: 'system' }, loan);
    expect(repo.created[0].createdBy).toBeNull();
  });

  it('refuses with every problem listed, and writes nothing', async () => {
    const { svc, repo } = make({ emp: employee({ authSubjectId: null, status: 'RESIGNED' }) });
    const err = await svc.plan(hr, { ...loan, endDate: undefined }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err.getResponse() as { message: string[] }).message.length).toBe(3);
    expect(repo.created).toHaveLength(0);
  });

  it('refuses a second assignment that overlaps the first', async () => {
    const { svc } = make();
    await svc.plan(hr, loan);
    const err = await svc
      .plan(hr, { ...loan, startDate: '2026-10-20', endDate: '2026-10-30' })
      .catch((e) => e);
    expect((err.getResponse() as { message: string[] }).message.join(' ')).toMatch(/bertabrakan/);
  });

  it('plans relative to the local day, not the UTC day (17:30 UTC is already tomorrow in WIB)', async () => {
    jest.useRealTimers();
    jest.useFakeTimers({ now: new Date('2026-10-09T17:30:00.000Z') }); // 2026-10-10 00:30 WIB
    const { svc } = make({ today: '2026-10-09' });
    jest.setSystemTime(new Date('2026-10-09T17:30:00.000Z'));
    // 10-10 is "today" in Jakarta, so starting on it is fine and starting on 10-09 is past.
    await expect(svc.plan(hr, { ...loan, startDate: '2026-10-10', endDate: '2026-10-12' })).resolves.toBeDefined();
    await expect(svc.plan(hr, { ...loan, startDate: '2026-10-09', endDate: '2026-10-12' })).rejects.toThrow();
  });

  it('reads the exit date and open permanent moves off the stored rows', async () => {
    const { svc, repo } = make({ emp: employee({ exitDate: day('2026-10-20') }) });
    await expect(svc.plan(hr, loan)).rejects.toBeInstanceOf(BadRequestException); // ends after exit
    repo.rows.push({
      id: 'perm',
      employeeId: 'emp-1',
      kind: 'PERMANENT',
      status: 'PLANNED',
      startDate: day('2026-10-12'),
      endDate: null,
    } as EmployeeDepotAssignment);
    const err = await svc
      .plan(hr, { ...loan, startDate: '2026-10-13', endDate: '2026-10-14' })
      .catch((e) => e);
    expect((err.getResponse() as { message: string[] }).message.join(' ')).toMatch(/bertabrakan/);
  });

  it('rejects an impossible calendar day with 400, not a 500', async () => {
    const { svc } = make();
    await expect(svc.plan(hr, { ...loan, startDate: '2026-02-30' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.plan(hr, { ...loan, endDate: '2026-13-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cancels a planned assignment; refuses a running or finished one; reports a lost race', async () => {
    const { svc, repo } = make();
    const row = await svc.plan(hr, loan);
    await expect(svc.cancel(hr, row.id)).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(svc.cancel(hr, row.id)).rejects.toThrow(/CANCELLED/);

    repo.rows.push({ id: 'as-run', employeeId: 'emp-1', status: 'ACTIVE' } as EmployeeDepotAssignment);
    await expect(svc.cancel(hr, 'as-run')).rejects.toThrow(/sudah berjalan/);

    repo.rows.push({ id: 'as-race', employeeId: 'emp-1', status: 'PLANNED' } as EmployeeDepotAssignment);
    repo.raceOnCancel = true;
    await expect(svc.cancel(hr, 'as-race')).rejects.toBeInstanceOf(ConflictException);

    await expect(svc.cancel(hr, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists, bounding the page size and checking the employee when one is named', async () => {
    const { svc, employees } = make();
    const spy = jest.spyOn(FakeAssignments.prototype, 'list');
    await svc.list(hr, { employeeId: 'emp-1', page: 0, pageSize: 5000 });
    expect(employees.getById).toHaveBeenCalledWith(hr, 'emp-1');
    expect((spy.mock.calls as unknown[][])[0][0]).toMatchObject({ skip: 0, take: 100, employeeId: 'emp-1' });
    await svc.list(hr, {});
    spy.mockRestore();
  });
});

describe('DepotAssignmentController', () => {
  it('delegates each route to the service', async () => {
    const svc = {
      list: jest.fn().mockResolvedValue('L'),
      plan: jest.fn().mockResolvedValue('P'),
      cancel: jest.fn().mockResolvedValue('C'),
    };
    const c = new DepotAssignmentController(svc as never);
    await expect(c.list({} as never, hr)).resolves.toBe('L');
    await expect(c.plan(loan as never, hr)).resolves.toBe('P');
    await expect(c.cancel('as-1', hr)).resolves.toBe('C');
  });
});

describe('DepotAssignmentPrismaRepository', () => {
  function build() {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      employeeDepotAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as unknown[]),
      ),
      employeeDepotAssignment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'a' }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    return { tx, prisma, repo: new DepotAssignmentPrismaRepository(prisma as never) };
  }
  const write: DepotAssignmentWrite = {
    employeeId: '11111111-1111-1111-1111-111111111111',
    kind: 'LOAN',
    depotId: PEKAYON,
    startDate: '2026-10-16',
    endDate: '2026-10-25',
    createdByRole: 'HR',
    createdBy: null,
    note: null,
  };

  it('locks the employee row, then reads open rows, then checks, then inserts - in that order', async () => {
    const { tx, repo } = build();
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(async () => void order.push('lock'));
    tx.employeeDepotAssignment.findMany.mockImplementation(async () => (order.push('read'), []));
    tx.employeeDepotAssignment.create.mockImplementation(async () => (order.push('insert'), {}));
    await repo.createChecked(write, () => void order.push('check'));
    expect(order).toEqual(['lock', 'read', 'check', 'insert']);
  });

  it('inserts nothing when the check refuses, and the refusal reaches the caller', async () => {
    const { tx, repo } = build();
    await expect(
      repo.createChecked(write, () => {
        throw new BadRequestException('no');
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.employeeDepotAssignment.create).not.toHaveBeenCalled();
  });

  it('stores local days as UTC midnight, and a permanent move with no end', async () => {
    const { tx, repo } = build();
    await repo.createChecked({ ...write, kind: 'PERMANENT', endDate: null }, () => undefined);
    const data = tx.employeeDepotAssignment.create.mock.calls[0][0].data;
    expect(data.startDate.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(data.endDate).toBeNull();
  });

  it('hasOpen / list / cancelPlanned read what they claim', async () => {
    const { prisma, repo } = build();
    expect(await repo.hasOpen('e')).toBe(false);
    prisma.employeeDepotAssignment.count.mockResolvedValue(2);
    expect(await repo.hasOpen('e')).toBe(true);

    await repo.list({ skip: 0, take: 10, depotIds: [GALAKSI], status: 'PLANNED', employeeId: 'e' });
    const where = prisma.employeeDepotAssignment.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.status).toBe('PLANNED');
    await repo.list({ skip: 0, take: 10 });

    expect(await repo.findById('a')).toEqual({ id: 'a' });
    expect(await repo.cancelPlanned('a')).toEqual({ id: 'a' });
    prisma.employeeDepotAssignment.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.cancelPlanned('a')).toBeNull();
  });
});

describe('DEPOT_ASSIGNMENT_ENABLED', () => {
  it('defaults to off in the env schema and the config getter', () => {
    const { value } = envValidationSchema.validate({
      HR_DATABASE_URL: 'postgresql://u:p@h:5432/d',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
    });
    expect(value.DEPOT_ASSIGNMENT_ENABLED).toBe(false);
    const cfg = new HrConfigService(new ConfigService({}) as never, {} as never);
    expect(cfg.depotAssignmentEnabled).toBe(false);
    expect(new HrConfigService(new ConfigService({ DEPOT_ASSIGNMENT_ENABLED: true }) as never, {} as never).depotAssignmentEnabled).toBe(true);
  });
});

describe('a permanent depot change while an assignment is open', () => {
  function emps(open: boolean) {
    const rows = [employee()];
    const repo = {
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      findByAuthSubjectId: async () => rows[0],
      findConflicting: async () => null,
      update: jest.fn(async () => rows[0]),
    };
    const assignments = { hasOpen: async () => open };
    return {
      repo,
      svc: new EmployeeService(repo as never, fakeIdentity(), undefined, undefined, undefined, undefined, assignments as never),
    };
  }

  it('is refused for update() and for the console transfer', async () => {
    const { svc, repo } = emps(true);
    await expect(svc.update(hr, 'emp-1', { depotId: PEKAYON })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.setDepotInternal('acct-1', PEKAYON)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('goes through when nothing is open, and other edits are never blocked', async () => {
    const { svc, repo } = emps(false);
    await svc.update(hr, 'emp-1', { depotId: PEKAYON });
    expect(repo.update).toHaveBeenCalledTimes(1);
    const open = emps(true);
    await open.svc.update(hr, 'emp-1', { fullName: 'Budi S' });
    expect(open.repo.update).toHaveBeenCalledTimes(1);
  });
});
