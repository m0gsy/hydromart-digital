import { DepotAssignmentApplier } from '../../src/application/services/depot-assignment-applier.service';
import { Employee, EmployeeDepotAssignment } from '../../prisma/generated/client';
import { DepotFlipExtras, DepotMoveWrite } from '../../src/application/ports/employee.repository';
import { HrConfigService } from '../../src/config/hr-config.service';

const GALAKSI = '11111111-1111-1111-1111-111111111111';
const PEKAYON = '22222222-2222-2222-2222-222222222222';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
// 2026-10-26 10:00 WIB
const NOW = new Date('2026-10-26T03:00:00.000Z');

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    role: 'STAFF_DEPOT',
    status: 'ACTIVE',
    authSubjectId: 'acct-1',
    depotId: GALAKSI,
    homeDepotId: GALAKSI,
    departmentId: null,
    ...over,
  } as Employee;
}

function assignment(over: Partial<EmployeeDepotAssignment> = {}): EmployeeDepotAssignment {
  return {
    id: 'as-1',
    employeeId: 'emp-1',
    kind: 'LOAN',
    depotId: PEKAYON,
    startDate: day('2026-10-16'),
    endDate: day('2026-10-25'),
    status: 'PLANNED',
    attempts: 0,
    createdByRole: 'HR',
    ...over,
  } as EmployeeDepotAssignment;
}

interface Call {
  id: string;
  data: Record<string, unknown>;
  history: { changeType: string; effectiveDate: Date }[];
  move?: DepotMoveWrite;
  extras?: DepotFlipExtras;
}

function make(opts: { enabled?: boolean; employees?: Employee[]; rows?: EmployeeDepotAssignment[] } = {}) {
  const employees = opts.employees ?? [employee()];
  const rows = opts.rows ?? [assignment()];
  const calls: Call[] = [];
  const roles: { role: string; depotId?: string | null; grantedBy?: string }[] = [];
  const failures: { id: string; reason: string; max: number }[] = [];
  const audits: { action: string }[] = [];
  const order: string[] = [];
  let identityFails = false;

  const assignments = {
    findDue: jest.fn(async (today: string) =>
      rows.filter(
        (r) =>
          (r.status === 'PLANNED' && r.startDate.toISOString().slice(0, 10) <= today) ||
          (r.status === 'ACTIVE' && r.kind === 'LOAN' && r.endDate!.toISOString().slice(0, 10) < today),
      ),
    ),
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    recordFailure: jest.fn(async (id: string, reason: string, max: number) => {
      failures.push({ id, reason, max });
    }),
  };
  const repo = {
    findById: jest.fn(async (id: string) => employees.find((e) => e.id === id) ?? null),
    update: jest.fn(async (id: string, data: Record<string, unknown>, history: Call['history'], move?: DepotMoveWrite, extras?: DepotFlipExtras) => {
      calls.push({ id, data, history, move, extras });
      const e = employees.find((x) => x.id === id)!;
      Object.assign(e, data);
      const a = extras?.assignment;
      if (a) Object.assign(rows.find((r) => r.id === a.id)!, a.data);
      order.push(`${id}:${move?.kind ?? 'none'}`);
      return e;
    }),
  };
  const identity = {
    assignRole: jest.fn(async (input: { role: string; depotId?: string | null; grantedBy?: string }) => {
      if (identityFails) throw new Error('auth down');
      roles.push(input);
    }),
  };
  const config = { depotAssignmentEnabled: opts.enabled ?? true, timeZone: 'Asia/Jakarta' } as HrConfigService;
  const audit = { record: jest.fn(async (e: { action: string }) => void audits.push(e)) };
  const departments = { findById: jest.fn(async () => ({ id: 'dep', depotId: GALAKSI })) };
  const svc = new DepotAssignmentApplier(
    assignments as never,
    repo as never,
    identity as never,
    config,
    audit as never,
    departments as never,
  );
  return {
    svc,
    employees,
    rows,
    calls,
    roles,
    failures,
    audits,
    order,
    assignments,
    departments,
    failIdentity: () => (identityFails = true),
  };
}

describe('DepotAssignmentApplier.applyDue', () => {
  it('does nothing while the flag is off, and says so', async () => {
    const t = make({ enabled: false });
    await expect(t.svc.applyDue(NOW)).resolves.toEqual({ due: 0, applied: 0, failed: 0, disabled: true });
    expect(t.assignments.findDue).not.toHaveBeenCalled();
  });

  it('starts a due loan: login first, then one write carrying ledger, state and pending requests', async () => {
    const t = make({ rows: [assignment({ endDate: day('2026-10-31') })] });
    const r = await t.svc.applyDue(NOW);
    expect(r).toEqual({ due: 1, applied: 1, failed: 0 });
    expect(t.roles).toEqual([{ customerId: 'acct-1', role: 'STAFF_DEPOT', depotId: PEKAYON, grantedBy: 'HR' }]);
    const [c] = t.calls;
    expect(c.data).toEqual({ depotId: PEKAYON }); // home untouched
    expect(c.move).toMatchObject({
      fromDepotId: GALAKSI,
      toDepotId: PEKAYON,
      kind: 'LOAN_START',
      assignmentId: 'as-1',
    });
    expect(c.move!.effectiveDate.toISOString()).toBe('2026-10-16T00:00:00.000Z'); // the planned day, not today
    expect(c.extras).toMatchObject({
      assignment: { id: 'as-1', data: { status: 'ACTIVE' } },
      movePendingRequestsTo: PEKAYON,
    });
    expect(c.history[0]).toMatchObject({ changeType: 'depotId' });
    expect(t.audits.map((a) => a.action)).toEqual(['DEPOT_ASSIGNMENT_START']);
  });

  it('a second round finds nothing left to do (idempotent)', async () => {
    const t = make({ rows: [assignment({ endDate: day('2026-10-31') })] });
    await t.svc.applyDue(NOW);
    const again = await t.svc.applyDue(NOW);
    expect(again).toEqual({ due: 0, applied: 0, failed: 0 });
    expect(t.calls).toHaveLength(1);
  });

  it('brings a finished loan home the day after its last day, with the real date', async () => {
    const t = make({
      employees: [employee({ depotId: PEKAYON })],
      rows: [assignment({ status: 'ACTIVE' })],
    });
    await t.svc.applyDue(NOW);
    const [c] = t.calls;
    expect(c.data).toEqual({ depotId: GALAKSI });
    expect(c.move).toMatchObject({ kind: 'LOAN_END', fromDepotId: PEKAYON, toDepotId: GALAKSI });
    expect(c.move!.effectiveDate.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(c.extras!.assignment!.data).toMatchObject({ status: 'DONE' });
    expect(c.extras!.movePendingRequestsTo).toBe(GALAKSI);
  });

  it('a head of depot is lent as a plain staff login and gets the head role back at home', async () => {
    const t = make({
      employees: [employee({ role: 'KEPALA_DEPOT' })],
      rows: [assignment({ endDate: day('2026-10-25') })],
    });
    await t.svc.applyDue(NOW); // start, then (span already over) end, in one round
    expect(t.roles.map((r) => r.role)).toEqual(['STAFF_DEPOT', 'KEPALA_DEPOT']);
    expect(t.employees[0].role).toBe('KEPALA_DEPOT'); // the employee row never changed
  });

  it('catches up a loan whose whole span passed while the sweep was down, with original dates', async () => {
    const t = make();
    const r = await t.svc.applyDue(NOW);
    expect(r.applied).toBe(2);
    expect(t.calls.map((c) => [c.move!.kind, c.move!.effectiveDate.toISOString().slice(0, 10)])).toEqual([
      ['LOAN_START', '2026-10-16'],
      ['LOAN_END', '2026-10-26'],
    ]);
    expect(t.employees[0].depotId).toBe(GALAKSI);
    expect(t.rows[0].status).toBe('DONE');
  });

  it('applies an end before a start that lands on the same day (hand-over without a stop at home)', async () => {
    const t = make({
      employees: [employee({ id: 'a', depotId: PEKAYON }), employee({ id: 'b', authSubjectId: 'acct-b' })],
      rows: [
        assignment({ id: 'start-b', employeeId: 'b', startDate: day('2026-10-26'), endDate: day('2026-10-30'), depotId: PEKAYON }),
        assignment({ id: 'end-a', employeeId: 'a', status: 'ACTIVE', endDate: day('2026-10-25') }),
      ],
    });
    await t.svc.applyDue(NOW);
    expect(t.order).toEqual(['a:LOAN_END', 'b:LOAN_START']);
  });

  it('applies a scheduled permanent move: home moves too, the assignment is done, a stranded department is released', async () => {
    const t = make({
      employees: [employee({ departmentId: 'dep' })],
      rows: [assignment({ kind: 'PERMANENT', endDate: null, startDate: day('2026-10-20') })],
    });
    await t.svc.applyDue(NOW);
    const [c] = t.calls;
    expect(c.data).toMatchObject({ depotId: PEKAYON, homeDepotId: PEKAYON, departmentId: null });
    expect(c.move).toMatchObject({ kind: 'PERMANENT' });
    expect(c.extras!.assignment!.data).toMatchObject({ status: 'DONE' });
    expect(t.roles[0].role).toBe('STAFF_DEPOT');
  });

  it('keeps a department that belongs to the destination depot', async () => {
    const t = make({
      employees: [employee({ departmentId: 'dep' })],
      rows: [assignment({ kind: 'PERMANENT', endDate: null, depotId: GALAKSI, startDate: day('2026-10-20') })],
    });
    t.employees[0].depotId = PEKAYON;
    t.employees[0].homeDepotId = PEKAYON;
    await t.svc.applyDue(NOW);
    expect(t.calls[0].data).not.toHaveProperty('departmentId');
  });

  it('does not move the login or the row when the person is already at the destination', async () => {
    const t = make({ employees: [employee({ depotId: PEKAYON })], rows: [assignment({ endDate: day('2026-10-31') })] });
    await t.svc.applyDue(NOW);
    expect(t.calls[0].move).toBeUndefined();
    expect(t.calls[0].data).toEqual({});
    expect(t.calls[0].extras!.movePendingRequestsTo).toBeUndefined();
    expect(t.rows[0].status).toBe('ACTIVE');
  });

  it('gives up at once on an employee who is no longer active, and never touches the login', async () => {
    const t = make({ employees: [employee({ status: 'RESIGNED' })], rows: [assignment({ endDate: day('2026-10-31') })] });
    const r = await t.svc.applyDue(NOW);
    expect(r).toEqual({ due: 1, applied: 0, failed: 1, ok: false });
    expect(t.failures).toEqual([{ id: 'as-1', reason: 'Karyawan tidak aktif lagi', max: 1 }]);
    expect(t.roles).toHaveLength(0);
    expect(t.calls).toHaveLength(0);
  });

  it('brings a resigned employee home in the ledger without calling the login service', async () => {
    const t = make({
      employees: [employee({ depotId: PEKAYON, status: 'RESIGNED' })],
      rows: [assignment({ status: 'ACTIVE' })],
    });
    await t.svc.applyDue(NOW);
    expect(t.roles).toHaveLength(0);
    expect(t.calls[0].move).toMatchObject({ kind: 'LOAN_END' });
  });

  it('a login push that fails writes nothing and is retried, counting an attempt', async () => {
    const t = make({ rows: [assignment({ endDate: day('2026-10-31') })] });
    t.failIdentity();
    const r = await t.svc.applyDue(NOW);
    expect(r).toEqual({ due: 1, applied: 0, failed: 1, ok: false });
    expect(t.calls).toHaveLength(0);
    expect(t.failures).toEqual([{ id: 'as-1', reason: 'auth down', max: DepotAssignmentApplier.MAX_ATTEMPTS }]);
    expect(t.rows[0].status).toBe('PLANNED'); // still due next tick
  });

  it('one bad row among good ones is not a failed round (ok stays unset)', async () => {
    const t = make({
      employees: [employee({ id: 'bad', status: 'RESIGNED' }), employee({ id: 'good', authSubjectId: 'acct-g' })],
      rows: [
        assignment({ id: 'a-bad', employeeId: 'bad', endDate: day('2026-10-31') }),
        assignment({ id: 'a-good', employeeId: 'good', endDate: day('2026-10-31') }),
      ],
    });
    const r = await t.svc.applyDue(NOW);
    expect(r).toEqual({ due: 2, applied: 1, failed: 1 });
  });

  it('refuses a jabatan the login service cannot carry, rather than guessing', async () => {
    const t = make({ employees: [employee({ role: 'HR' as never })], rows: [assignment({ endDate: day('2026-10-31') })] });
    const r = await t.svc.applyDue(NOW);
    expect(r.failed).toBe(1);
    expect(t.failures[0].reason).toMatch(/jabatan/i);
  });

  it('survives the failure recorder failing (the round still completes)', async () => {
    const t = make({ rows: [assignment({ endDate: day('2026-10-31') })] });
    t.failIdentity();
    t.assignments.recordFailure.mockRejectedValueOnce(new Error('db down'));
    await expect(t.svc.applyDue(NOW)).resolves.toMatchObject({ failed: 1 });
  });

  it('a missing employee row is a failure, not a crash', async () => {
    const t = make({ employees: [], rows: [assignment({ endDate: day('2026-10-31') })] });
    await expect(t.svc.applyDue(NOW)).resolves.toMatchObject({ failed: 1 });
  });

  it('cannot start a destination it does not know on the way home (employee has no home depot)', async () => {
    const t = make({
      employees: [employee({ depotId: PEKAYON, homeDepotId: null })],
      rows: [assignment({ status: 'ACTIVE' })],
    });
    const r = await t.svc.applyDue(NOW);
    expect(r.failed).toBe(1);
    expect(t.failures[0].reason).toMatch(/tujuan/i);
  });
});

describe('DepotAssignmentApplier.applyOne / cutActive', () => {
  it('applyOne starts a PLANNED row and ends an ACTIVE one', async () => {
    const t = make({ rows: [assignment({ endDate: day('2026-10-31') })] });
    await t.svc.applyOne(t.rows[0], NOW);
    expect(t.calls[0].move!.kind).toBe('LOAN_START');
    await t.svc.applyOne(t.rows[0], NOW);
    expect(t.calls[1].move!.kind).toBe('LOAN_END');
  });

  it('cutActive sends the person home today and ends the loan yesterday on paper', async () => {
    const t = make({
      employees: [employee({ depotId: PEKAYON })],
      rows: [assignment({ status: 'ACTIVE', endDate: day('2026-10-31') })],
    });
    await t.svc.cutActive(t.rows[0], NOW);
    expect(t.calls[0].move!.effectiveDate.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(t.calls[0].extras!.assignment!.data).toMatchObject({ status: 'DONE' });
    expect((t.calls[0].extras!.assignment!.data as { endDate: Date }).endDate.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('a loan cut on its very first day keeps one day on paper (end >= start)', async () => {
    const t = make({
      employees: [employee({ depotId: PEKAYON })],
      rows: [assignment({ status: 'ACTIVE', startDate: day('2026-10-26'), endDate: day('2026-10-31') })],
    });
    await t.svc.cutActive(t.rows[0], NOW);
    expect((t.calls[0].extras!.assignment!.data as { endDate: Date }).endDate.toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});

describe('less common paths', () => {
  it('works with the real clock when no time is passed, and tolerates a row with no creator role', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const t = make({ rows: [assignment({ endDate: day('2026-10-31'), createdByRole: null })] });
      await expect(t.svc.applyDue()).resolves.toMatchObject({ applied: 1 });
      expect(t.roles[0].grantedBy).toBeUndefined();
      await expect(t.svc.applyOne(t.rows[0])).resolves.toBeUndefined();
      const cut = make({
        employees: [employee({ depotId: PEKAYON })],
        rows: [assignment({ status: 'ACTIVE', endDate: day('2026-10-31') })],
      });
      await cut.svc.cutActive(cut.rows[0]);
      expect(cut.calls[0].move!.kind).toBe('LOAN_END');
    } finally {
      jest.useRealTimers();
    }
  });

  it('records a person with no current depot as coming from nowhere', async () => {
    const t = make({ employees: [employee({ depotId: null })], rows: [assignment({ endDate: day('2026-10-31') })] });
    await t.svc.applyDue(NOW);
    expect(t.calls[0].move!.fromDepotId).toBeNull();
    expect(t.calls[0].history[0]).toMatchObject({ fromValue: expect.anything() });
  });

  it('copes with no department service, and with a person who has no department', async () => {
    const noDept = make({
      employees: [employee({ departmentId: null })],
      rows: [assignment({ kind: 'PERMANENT', endDate: null, startDate: day('2026-10-20') })],
    });
    await noDept.svc.applyDue(NOW);
    expect(noDept.departments.findById).not.toHaveBeenCalled();
    const bare = new DepotAssignmentApplier(
      { findDue: async () => [assignment({ kind: 'PERMANENT', endDate: null, startDate: day('2026-10-20') })], recordFailure: async () => undefined } as never,
      { findById: async () => employee({ departmentId: 'dep' }), update: jest.fn(async () => employee()) } as never,
      { assignRole: async () => undefined } as never,
      { depotAssignmentEnabled: true, timeZone: 'Asia/Jakarta' } as never,
      { record: async () => undefined } as never,
    );
    await expect(bare.applyDue(NOW)).resolves.toMatchObject({ applied: 1 });
  });

  it('applies two starts that land on the same day in the order they were planned', async () => {
    const t = make({
      employees: [employee({ id: 'a' }), employee({ id: 'b', authSubjectId: 'acct-b' })],
      rows: [
        assignment({ id: 'x1', employeeId: 'a', endDate: day('2026-10-31') }),
        assignment({ id: 'x2', employeeId: 'b', endDate: day('2026-10-31') }),
      ],
    });
    await t.svc.applyDue(NOW);
    expect(t.order).toEqual(['a:LOAN_START', 'b:LOAN_START']);
  });

  it('reports a non-Error rejection by its text', async () => {
    const t = make({ rows: [assignment({ endDate: day('2026-10-31') })] });
    (t.svc as unknown as { identity: { assignRole: () => Promise<void> } }).identity.assignRole = () =>
      Promise.reject('plain string');
    await t.svc.applyDue(NOW);
    expect(t.failures[0].reason).toBe('plain string');
  });
});

describe('the Jakarta day, not the UTC day', () => {
  it('at 00:30 WIB on the 26th a loan starting the 26th is already due', async () => {
    const t = make({ rows: [assignment({ startDate: day('2026-10-26'), endDate: day('2026-10-31') })] });
    // 2026-10-25T17:30Z is 2026-10-26 00:30 in Jakarta; in UTC it is still the 25th.
    const r = await t.svc.applyDue(new Date('2026-10-25T17:30:00.000Z'));
    expect(r.applied).toBe(1);
  });
});
