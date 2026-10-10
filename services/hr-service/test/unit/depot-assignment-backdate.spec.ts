import { DepotAssignmentService } from '../../src/application/services/depot-assignment.service';

const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

function build(opts: {
  slips?: Record<string, { status: string } | null>;
  rows?: { depotId: string | null }[];
  withReaders?: boolean;
}) {
  const repo = {
    createChecked: jest.fn(async (data: Record<string, unknown>, check: (o: unknown[]) => void) => {
      check([]);
      return { id: 'as-1', ...data };
    }),
  };
  const employees = {
    getById: async () => ({
      id: 'emp-1',
      role: 'STAFF_DEPOT',
      authSubjectId: 'a',
      status: 'ACTIVE',
      depotId: G,
      homeDepotId: G,
      joinDate: day('2026-01-01'),
      exitDate: null,
    }),
  };
  const payrolls = {
    findByEmployeeAndPeriod: jest.fn(async (_e: string, m: string) => opts.slips?.[m] ?? null),
  };
  const attendance = { list: jest.fn(async () => ({ rows: opts.rows ?? [], total: 0 })) };
  const withReaders = opts.withReaders ?? true;
  const svc = new DepotAssignmentService(
    repo as never,
    employees as never,
    { depotAssignmentEnabled: true, timeZone: 'Asia/Jakarta' } as never,
    {} as never,
    undefined,
    withReaders ? (payrolls as never) : undefined,
    withReaders ? (attendance as never) : undefined,
  );
  return { svc, repo, payrolls, attendance };
}

const input = {
  employeeId: 'emp-1',
  kind: 'LOAN' as const,
  depotId: P,
  startDate: '2026-09-28',
  endDate: '2026-10-05',
};
const msg = (e: { getResponse(): unknown }) => {
  const m = (e.getResponse() as { message: string | string[] }).message;
  return Array.isArray(m) ? m.join(' ') : m;
};

describe('DepotAssignmentService.plan: backdating', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-10T03:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('HR may start in the past when no slip is closed and no stamp disagrees', async () => {
    const { svc, payrolls, attendance } = build({ slips: { '2026-09': { status: 'DRAFT' } } });
    await expect(svc.plan({ sub: 'x', role: 'HR' } as never, input)).resolves.toBeDefined();
    expect(payrolls.findByEmployeeAndPeriod).toHaveBeenCalledWith('emp-1', '2026-09');
    expect(payrolls.findByEmployeeAndPeriod).toHaveBeenCalledWith('emp-1', '2026-10');
    expect(attendance.list).toHaveBeenCalledWith(
      expect.objectContaining({ from: day('2026-09-28'), to: day('2026-10-05') }),
    );
  });

  it('a planner who is not HR still cannot, and nothing is read for them', async () => {
    const { svc, payrolls } = build({});
    const err = await svc.plan({ sub: 'x', role: 'DIREKTUR' } as never, input).catch((e) => e);
    expect(msg(err)).toMatch(/lampau/);
    expect(payrolls.findByEmployeeAndPeriod).not.toHaveBeenCalled();
  });

  it('refuses when a month in the window is APPROVED or PAID', async () => {
    const { svc } = build({ slips: { '2026-09': { status: 'APPROVED' } } });
    const err = await svc.plan({ sub: 'x', role: 'SUPER_ADMIN' } as never, input).catch((e) => e);
    expect(msg(err)).toMatch(/2026-09.*disetujui atau dibayar/);
  });

  it('refuses when attendance in the window was stamped at another depot', async () => {
    const { svc } = build({ rows: [{ depotId: G }, { depotId: P }, { depotId: null }] });
    const err = await svc.plan({ sub: 'x', role: 'HR' } as never, input).catch((e) => e);
    expect(msg(err)).toMatch(/1 hari absensi/);
  });

  it('an open-ended plan reads attendance up to yesterday', async () => {
    const { svc, attendance } = build({});
    await svc.plan(
      { sub: 'x', role: 'HR' } as never,
      { ...input, kind: 'PERMANENT', endDate: null } as never,
    );
    expect(attendance.list).toHaveBeenCalledWith(
      expect.objectContaining({ to: day('2026-10-09') }),
    );
  });

  it('without the payroll/attendance readers the past stays closed even for HR', async () => {
    const { svc } = build({ withReaders: false });
    const err = await svc.plan({ sub: 'x', role: 'HR' } as never, input).catch((e) => e);
    expect(msg(err)).toMatch(/lampau/);
  });

  it('walks a December → January window month by month', async () => {
    jest.setSystemTime(new Date('2027-01-10T03:00:00.000Z'));
    const { svc, payrolls } = build({});
    await svc.plan({ sub: 'x', role: 'HR' } as never, {
      ...input,
      startDate: '2026-12-20',
      endDate: '2027-01-05',
    });
    expect(payrolls.findByEmployeeAndPeriod.mock.calls.map((c) => c[1])).toEqual([
      '2026-12',
      '2027-01',
    ]);
  });
});
