import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, LeaveBalance, LeaveRequest, LeaveStatus } from '../../prisma/generated/client';
import {
  LeaveDecision,
  LeaveListFilter,
  LeaveRepository,
  LeaveRequestWrite,
} from '../../src/application/ports/leave.repository';
import { ManualAttendanceInput } from '../../src/application/ports/attendance.repository';
import { NotificationPort } from '../../src/application/ports/notification.port';
import { LeaveService, SubmitLeaveInput } from '../../src/application/services/leave.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { HrConfigService } from '../../src/config/hr-config.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const staff: AuthenticatedUser = {
  sub: 'auth-emp',
  role: 'STAFF_DEPOT' as never,
  phone: '0811',
  depotId: DEPOT_A,
};
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'MANAGER' as never,
  phone: '0800',
  depotId,
});

const EMPLOYEE = {
  id: 'emp-1',
  depotId: DEPOT_A,
  fullName: 'Budi',
  phone: '0811',
  authSubjectId: 'auth-emp',
  supervisorId: 'emp-boss',
} as Employee;

const SUPERVISOR = {
  id: 'emp-boss',
  depotId: DEPOT_A,
  fullName: 'Sari',
  phone: '0899',
  authSubjectId: 'auth-boss',
} as Employee;

class FakeLeaveRepo implements LeaveRepository {
  rows: LeaveRequest[] = [];
  balances: LeaveBalance[] = [];
  private seq = 0;
  async create(data: LeaveRequestWrite): Promise<LeaveRequest> {
    const row = {
      id: `lv-${++this.seq}`,
      status: 'PENDING_MANAGER' as LeaveStatus,
      decisionNote: null,
      ...data,
    } as unknown as LeaveRequest;
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<LeaveRequest | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async decide(id: string, decision: LeaveDecision): Promise<LeaveRequest> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, decision);
    return row;
  }
  async list(filter: LeaveListFilter) {
    let rows = this.rows;
    if (filter.employeeId) rows = rows.filter((r) => r.employeeId === filter.employeeId);
    if (filter.depotIds)
      rows = rows.filter((r) => !!r.depotId && filter.depotIds!.includes(r.depotId));
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    // PG-06: the real repository joins the name on; the fake carries the field so the
    // types match what the queue actually receives.
    return {
      rows: rows
        .slice(filter.skip, filter.skip + filter.take)
        .map((r) => ({ ...r, employeeName: null })),
      total: rows.length,
    };
  }
  async listBlocking(employeeId: string, statuses: LeaveStatus[]): Promise<LeaveRequest[]> {
    return this.rows.filter((r) => r.employeeId === employeeId && statuses.includes(r.status));
  }
  async findBalance(employeeId: string, year: number): Promise<LeaveBalance | null> {
    return this.balances.find((b) => b.employeeId === employeeId && b.year === year) ?? null;
  }
  async ensureBalance(employeeId: string, year: number, quotaDays: number): Promise<LeaveBalance> {
    const found = await this.findBalance(employeeId, year);
    if (found) return found;
    const row = { id: `bal-${year}`, employeeId, year, quotaDays, usedDays: 0 } as LeaveBalance;
    this.balances.push(row);
    return row;
  }
  async addUsedDays(employeeId: string, year: number, days: number): Promise<LeaveBalance> {
    const row = (await this.findBalance(employeeId, year))!;
    row.usedDays += days;
    return row;
  }
  async setBalance(
    employeeId: string,
    year: number,
    quotaDays: number,
    usedDays: number,
  ): Promise<{ balance: LeaveBalance; existed: boolean }> {
    const found = await this.findBalance(employeeId, year);
    if (found) {
      found.quotaDays = quotaDays;
      found.usedDays = usedDays;
      return { balance: found, existed: true };
    }
    const row = { id: `bal-${year}`, employeeId, year, quotaDays, usedDays } as LeaveBalance;
    this.balances.push(row);
    return { balance: row, existed: false };
  }
}

function make(opts: { holidays?: string[]; weeklyOff?: string; quota?: number } = {}) {
  const repo = new FakeLeaveRepo();
  const attendanceWrites: ManualAttendanceInput[] = [];
  const attendance = {
    upsertManual: async (input: ManualAttendanceInput) => {
      attendanceWrites.push(input);
      return {} as never;
    },
  } as never;
  const employees = {
    getSelf: async (user: AuthenticatedUser) => {
      if (user.sub !== 'auth-emp') throw new NotFoundException('Akun ini belum tertaut');
      return EMPLOYEE;
    },
    findByIdInternal: async (id: string) =>
      id === EMPLOYEE.id ? EMPLOYEE : id === SUPERVISOR.id ? SUPERVISOR : null,
    // The reporting line resolves by ACCOUNT now, through depot-service's supervision
    // table — Employee.supervisorId is no longer written or read.
    findByAuthSubjectId: async (accountId: string) =>
      accountId === SUPERVISOR.authSubjectId ? SUPERVISOR : null,
  } as unknown as EmployeeService;
  const supervision = {
    superiorOf: async (accountId: string) =>
      accountId === EMPLOYEE.authSubjectId ? SUPERVISOR.authSubjectId : null,
    setSuperior: async () => {},
  };
  const config = {
    weeklyOffDays: () => opts.weeklyOff ?? '',
    annualLeaveQuotaDays: () => opts.quota ?? 12,
  } as unknown as HrConfigService;
  const holidays = { listDates: async () => opts.holidays ?? [] } as never;
  const sent: { event: string; phone: string; vars: Record<string, string> }[] = [];
  const notifications: NotificationPort = {
    notify: async (event, phone, vars) => {
      sent.push({ event, phone, vars });
    },
  };
  return {
    repo,
    attendanceWrites,
    sent,
    employees,
    supervision,
    svc: new LeaveService(repo, attendance, employees, config, holidays, notifications, supervision),
  };
}

const APPLY: SubmitLeaveInput = {
  type: 'ANNUAL',
  startDate: '2026-07-06',
  endDate: '2026-07-10',
  reason: 'Acara keluarga',
};

async function approvedRequest(ctx: ReturnType<typeof make>, apply = APPLY) {
  const req = await ctx.svc.submit(staff, apply);
  await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
  return ctx.svc.decideHr(hr, req.id, true);
}

describe('LeaveService.submit', () => {
  it('freezes the working days and starts at the manager stage', async () => {
    const { svc } = make();
    const req = await svc.submit(staff, APPLY);
    expect(req).toMatchObject({ workingDays: 5, status: 'PENDING_MANAGER', depotId: DEPOT_A });
  });

  it('does not charge a holiday or a weekly-off day inside the range', async () => {
    const { svc } = make({ holidays: ['2026-07-08'], weeklyOff: '0' });
    const req = await svc.submit(staff, { ...APPLY, endDate: '2026-07-13' });
    // Mon 6th → Mon 13th is 8 days; the Wed holiday and Sunday the 12th cost nothing.
    expect(req.workingDays).toBe(6);
  });

  it('rejects an inverted range and a range with no working day', async () => {
    const { svc } = make({ weeklyOff: '0' });
    await expect(
      svc.submit(staff, { ...APPLY, startDate: '2026-07-10', endDate: '2026-07-06' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.submit(staff, { ...APPLY, startDate: '2026-07-05', endDate: '2026-07-05' }),
    ).rejects.toThrow(/hari kerja/);
  });

  it('rejects a second application that overlaps a pending one', async () => {
    const { svc } = make();
    await svc.submit(staff, APPLY);
    await expect(svc.submit(staff, { ...APPLY, startDate: '2026-07-09' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows a second application that does not overlap', async () => {
    const { svc } = make();
    await svc.submit(staff, APPLY);
    const second = await svc.submit(staff, {
      ...APPLY,
      startDate: '2026-07-13',
      endDate: '2026-07-14',
    });
    expect(second.workingDays).toBe(2);
  });

  it('refuses annual leave beyond the remaining quota', async () => {
    const { svc } = make({ quota: 3 });
    await expect(svc.submit(staff, APPLY)).rejects.toThrow(/Sisa kuota/);
  });

  it('lets sick leave through even with no quota left', async () => {
    const { svc } = make({ quota: 0 });
    const req = await svc.submit(staff, { ...APPLY, type: 'SICK' });
    expect(req.workingDays).toBe(5);
  });

  it('notifies the supervisor, not the applicant', async () => {
    const { sent, svc } = make();
    await svc.submit(staff, APPLY);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ event: 'LEAVE_SUBMITTED', phone: SUPERVISOR.phone });
    expect(sent[0].vars).toMatchObject({ name: 'Budi', from: '2026-07-06', to: '2026-07-10' });
  });

  // The notification is a courtesy on top of the request; approval rights come from role
  // and depot scope, never from this link. So a broken link costs the message, not the leave.
  it('still records the request when the reporting line leads nowhere', async () => {
    const noSuperior = make();
    noSuperior.supervision.superiorOf = async () => null;
    await expect(noSuperior.svc.submit(staff, APPLY)).resolves.toMatchObject({
      status: 'PENDING_MANAGER',
    });
    expect(noSuperior.sent).toEqual([]);

    // Recorded as somebody's superior, but that account has no employee row to phone.
    const noEmployee = make();
    (noEmployee.employees as { findByAuthSubjectId: unknown }).findByAuthSubjectId = async () =>
      null;
    await expect(noEmployee.svc.submit(staff, APPLY)).resolves.toMatchObject({
      status: 'PENDING_MANAGER',
    });
    expect(noEmployee.sent).toEqual([]);
  });
});

describe('LeaveService approval flow', () => {
  it('writes one LEAVE attendance row per working day, only on the HR approval', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
    expect(ctx.attendanceWrites).toHaveLength(0);

    const approved = await ctx.svc.decideHr(hr, req.id, true);
    expect(approved.status).toBe('APPROVED');
    expect(ctx.attendanceWrites).toHaveLength(5);
    expect(ctx.attendanceWrites[0]).toMatchObject({
      employeeId: 'emp-1',
      depotId: DEPOT_A,
      status: 'LEAVE',
    });
    expect(ctx.attendanceWrites.map((w) => w.workDate.toISOString().slice(0, 10))).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ]);
  });

  it('skips a holiday when stamping the attendance rows', async () => {
    const ctx = make({ holidays: ['2026-07-08'] });
    await approvedRequest(ctx);
    expect(ctx.attendanceWrites.map((w) => w.workDate.toISOString().slice(0, 10))).not.toContain(
      '2026-07-08',
    );
  });

  it('moves the quota on approval, never on submit', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    expect((await ctx.repo.findBalance('emp-1', 2026))!.usedDays).toBe(0);
    await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
    await ctx.svc.decideHr(hr, req.id, true);
    expect((await ctx.repo.findBalance('emp-1', 2026))!.usedDays).toBe(5);
  });

  it('leaves the quota alone for sick leave, but still stamps attendance', async () => {
    const ctx = make();
    await approvedRequest(ctx, { ...APPLY, type: 'SICK' });
    expect(ctx.attendanceWrites).toHaveLength(5);
    expect(await ctx.repo.findBalance('emp-1', 2026)).toBeNull();
  });

  it('lets HR reject what the manager already approved', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
    const decided = await ctx.svc.decideHr(hr, req.id, false, 'Kuota depot habis');
    expect(decided.status).toBe('REJECTED');
    expect(ctx.attendanceWrites).toHaveLength(0); // nothing stamped for a rejection
  });

  it('notifies the employee on approval and on rejection', async () => {
    const ctx = make();
    await approvedRequest(ctx);
    expect(ctx.sent.map((s) => s.event)).toEqual(['LEAVE_SUBMITTED', 'LEAVE_APPROVED']);

    const other = make();
    const req = await other.svc.submit(staff, APPLY);
    await other.svc.decideManager(manager(DEPOT_A), req.id, false, 'Depot sedang sibuk');
    expect(other.sent.map((s) => s.event)).toEqual(['LEAVE_SUBMITTED', 'LEAVE_REJECTED']);
    expect(other.sent[1].vars.reason).toBe('Depot sedang sibuk');
  });

  it('demands a reason when rejecting', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await expect(ctx.svc.decideManager(manager(DEPOT_A), req.id, false)).rejects.toThrow(
      /Alasan penolakan/,
    );
    await expect(ctx.svc.decideManager(manager(DEPOT_A), req.id, false, '   ')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to skip the manager stage', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await expect(ctx.svc.decideHr(hr, req.id, true)).rejects.toThrow(ConflictException);
    expect(ctx.attendanceWrites).toHaveLength(0);
  });

  it('refuses to decide the same request twice', async () => {
    const ctx = make();
    const approved = await approvedRequest(ctx);
    await expect(ctx.svc.decideHr(hr, approved.id, true)).rejects.toThrow(ConflictException);
    expect(ctx.attendanceWrites).toHaveLength(5); // not stamped again
  });

  it('keeps a manager out of another depot’s queue', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await expect(ctx.svc.decideManager(manager(DEPOT_B), req.id, true)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s on an unknown request', async () => {
    const { svc } = make();
    await expect(svc.decideManager(hr, 'nope', true)).rejects.toThrow(NotFoundException);
  });
});

describe('LeaveService cancel', () => {
  it('withdraws a pending application', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    expect((await ctx.svc.cancel(staff, req.id)).status).toBe('CANCELLED');
  });

  it('cannot withdraw once it is approved', async () => {
    const ctx = make();
    const approved = await approvedRequest(ctx);
    await expect(ctx.svc.cancel(staff, approved.id)).rejects.toThrow(ConflictException);
  });

  it('cannot withdraw somebody else’s application', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    ctx.repo.rows[0] = { ...req, employeeId: 'someone-else' } as LeaveRequest;
    await expect(ctx.svc.cancel(staff, req.id)).rejects.toThrow(ForbiddenException);
  });
});

describe('LeaveService reads', () => {
  it('lists only my own applications', async () => {
    const ctx = make();
    await ctx.svc.submit(staff, APPLY);
    const mine = await ctx.svc.listSelf(staff);
    expect(mine.total).toBe(1);
  });

  it('creates the year balance on first read with the configured quota', async () => {
    const { svc } = make({ quota: 15 });
    expect(await svc.myBalance(staff, 2026)).toMatchObject({
      year: 2026,
      quotaDays: 15,
      usedDays: 0,
    });
  });

  it('reads the current year balance when no year is asked for', async () => {
    const { svc } = make({ quota: 15 });
    const thisYear = new Date().getUTCFullYear();
    expect(await svc.myBalance(staff)).toMatchObject({ year: thisYear, quotaDays: 15 });
  });

  it('forces a depot manager to their own depot in the approval queue', async () => {
    const ctx = make();
    await ctx.svc.submit(staff, APPLY);
    expect((await ctx.svc.listForApproval(manager(DEPOT_A))).total).toBe(1);
    expect((await ctx.svc.listForApproval(manager(DEPOT_B))).total).toBe(0);
    expect((await ctx.svc.listForApproval(hr, { status: 'PENDING_MANAGER' })).total).toBe(1);
  });
});

describe('LeaveService without optional collaborators', () => {
  // Nothing to notify when the person has no login yet: the message is skipped, not attempted
  // against a null recipient.
  it('skips both notifications when neither party has a linked account', async () => {
    const repo = new FakeLeaveRepo();
    const attendance = { upsertManual: async () => ({}) as never } as never;
    const unlinked = { ...EMPLOYEE, authSubjectId: null };
    const employees = {
      getSelf: async () => unlinked,
      findByIdInternal: async () => ({ ...SUPERVISOR, authSubjectId: null }),
      // CA-1-40 asks who the decider is; an approver with no employee row is normal.
      findByAuthSubjectId: async () => null,
    } as unknown as EmployeeService;
    const config = {
      weeklyOffDays: () => '',
      annualLeaveQuotaDays: () => 12,
    } as unknown as HrConfigService;
    const sent: string[] = [];
    const notifications: NotificationPort = {
      notify: async (event) => void sent.push(event),
    };
    const svc = new LeaveService(
      repo,
      attendance,
      employees,
      config,
      { listDates: async () => [] } as never,
      notifications,
    );

    const req = await svc.submit(staff, APPLY);
    await svc.decideManager(manager(DEPOT_A), req.id, false, 'tidak disetujui');
    expect(sent).toEqual([]);
  });

  it('works with no holiday repository and no notification port', async () => {
    const repo = new FakeLeaveRepo();
    const writes: ManualAttendanceInput[] = [];
    const attendance = {
      upsertManual: async (input: ManualAttendanceInput) => {
        writes.push(input);
        return {} as never;
      },
    } as never;
    const employees = {
      getSelf: async () => EMPLOYEE,
      findByIdInternal: async () => EMPLOYEE,
      // CA-1-40: the decider lookup. Null = this approver has no employee row of their own.
      findByAuthSubjectId: async () => null,
    } as unknown as EmployeeService;
    const config = {
      weeklyOffDays: () => '',
      annualLeaveQuotaDays: () => 12,
    } as unknown as HrConfigService;
    const svc = new LeaveService(repo, attendance, employees, config);

    const req = await svc.submit(staff, APPLY);
    await svc.decideManager(manager(DEPOT_A), req.id, true);
    const approved = await svc.decideHr(hr, req.id, true);
    expect(approved.status).toBe('APPROVED');
    expect(writes).toHaveLength(5);
  });
});

/*
 * CA-1-40 — two stages, two people.
 *
 * Both decision paths checked exactly one thing: does this account reach the request's depot.
 * `leaveApprove` (stage 1) is MANAGER + HR and `hrAdmin` (stage 2) includes HR, so an HR
 * staffer with an employee record of their own held BOTH stages over their OWN application —
 * the two-stage flow collapsed into one click by the applicant.
 */
describe('LeaveService · CA-1-40 nobody signs both stages, nobody signs their own', () => {
  /** An HR account that is ALSO the applicant — the exact overlap the card describes. */
  function selfApplicant(ctx: ReturnType<typeof make>) {
    (ctx.employees as { findByAuthSubjectId: unknown }).findByAuthSubjectId = async (
      accountId: string,
    ) => (accountId === 'hr-1' ? { ...EMPLOYEE, authSubjectId: 'hr-1' } : null);
  }

  it('refuses stage 1 from the applicant', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    selfApplicant(ctx);
    await expect(ctx.svc.decideManager(hr, req.id, true)).rejects.toThrow(/sendiri/i);
  });

  it('refuses stage 2 from the applicant', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
    selfApplicant(ctx);
    await expect(ctx.svc.decideHr(hr, req.id, true)).rejects.toThrow(/sendiri/i);
  });

  it('refuses stage 2 from whoever signed stage 1', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    // One account holding both capabilities signs stage 1, then reaches for stage 2.
    await ctx.svc.decideManager(hr, req.id, true);
    // Two signatures from one account are one signature written twice.
    await expect(ctx.svc.decideHr(hr, req.id, true)).rejects.toThrow(/orang lain/i);
  });

  it('still allows the normal two-person path', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
    const done = await ctx.svc.decideHr(hr, req.id, true);
    expect(done.status).toBe('APPROVED');
  });

  it('does not 404 an approver who has no employee record of their own', async () => {
    const ctx = make();
    const req = await ctx.svc.submit(staff, APPLY);
    // Head office and the superuser have no Employee row; findByAuthSubjectId returns null.
    // `getSelf` would have thrown here, which is why the guard uses the lookup that cannot.
    await ctx.svc.decideManager(manager(DEPOT_A), req.id, true);
    const done = await ctx.svc.decideHr(hr, req.id, true);
    expect(done.status).toBe('APPROVED');
  });
});
