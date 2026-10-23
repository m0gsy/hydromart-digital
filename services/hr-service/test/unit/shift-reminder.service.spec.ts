import { ShiftReminderService } from '../../src/application/services/shift-reminder.service';
import { ShiftReminderController } from '../../src/modules/shift-reminder.controller';

// 2026-10-23 (a Friday) 07:25 in Jakarta is 00:25 UTC. Shifts starting 07:55-08:10 are due.
const NOW = new Date('2026-10-23T00:25:00.000Z');
const WORK_DATE = new Date('2026-10-23T00:00:00.000Z');

const assignment = (over: Record<string, unknown>) => ({
  id: 'a1',
  employeeId: 'e1',
  shiftId: 's-morning',
  rotationId: null,
  effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  ...over,
});

function build(opts: {
  assignments?: unknown[];
  shifts?: Record<string, { startTime: string }>;
  rotations?: Record<string, { pattern: unknown }>;
  attendance?: unknown;
  employee?: Record<string, unknown> | null;
  notify?: jest.Mock | null;
}) {
  const notify = opts.notify === undefined ? jest.fn(async () => undefined) : opts.notify;
  const shifts = {
    listAllAssignmentsUpTo: jest.fn(async () => opts.assignments ?? [assignment({})]),
    findById: jest.fn(async (id: string) => opts.shifts?.[id] ?? null),
    findRotationById: jest.fn(async (id: string) => opts.rotations?.[id] ?? null),
  };
  const attendance = { findByEmployeeAndDate: jest.fn(async () => opts.attendance ?? null) };
  const employees = {
    findByIdInternal: jest.fn(async () =>
      opts.employee === null
        ? null
        : {
            id: 'e1',
            status: 'ACTIVE',
            authSubjectId: 'acct-1',
            phone: '0811',
            fullName: 'Budi',
            ...opts.employee,
          },
    ),
  };
  const service = new ShiftReminderService(
    shifts as never,
    attendance as never,
    employees as never,
    { timeZone: 'Asia/Jakarta' } as never,
    notify ? ({ notify } as never) : undefined,
  );
  return { service, notify, shifts, attendance, employees };
}

const MORNING = { 's-morning': { startTime: '08:00' } };

describe('ShiftReminderService', () => {
  it('reminds a rota employee whose shift starts 30-45 minutes from now', async () => {
    const { service, notify } = build({ shifts: MORNING });
    expect(await service.remindStartingSoon(NOW)).toEqual({
      reminded: 1,
      skipped: 0,
      failed: 0,
      ok: true,
    });
    expect(notify).toHaveBeenCalledWith('SHIFT_REMINDER', '0811', { name: 'Budi', time: '08:00' }, 'acct-1');
  });

  it('leaves shifts outside the window, so none is mentioned twice', async () => {
    const early = build({ shifts: { 's-morning': { startTime: '07:30' } } });
    const late = build({ shifts: { 's-morning': { startTime: '08:15' } } });
    expect((await early.service.remindStartingSoon(NOW)).reminded).toBe(0);
    expect((await late.service.remindStartingSoon(NOW)).reminded).toBe(0);
  });

  it('skips someone already in, or on approved leave (an attendance row exists)', async () => {
    const { service, notify, employees } = build({ shifts: MORNING, attendance: { id: 'x' } });
    expect(await service.remindStartingSoon(NOW)).toMatchObject({ reminded: 0, skipped: 1 });
    expect(notify).not.toHaveBeenCalled();
    expect(employees.findByIdInternal).not.toHaveBeenCalled();
  });

  it('skips an employee who is inactive or has no login', async () => {
    const inactive = build({ shifts: MORNING, employee: { status: 'RESIGNED' } });
    const noLogin = build({ shifts: MORNING, employee: { authSubjectId: null } });
    const gone = build({ shifts: MORNING, employee: null });
    for (const b of [inactive, noLogin, gone]) {
      expect(await b.service.remindStartingSoon(NOW)).toMatchObject({ reminded: 0, skipped: 1 });
    }
  });

  describe('rotations', () => {
    // 0 = Sunday ... 5 = Friday (the day under test).
    const rotation = (friday: string | null) => ({
      'r-1': { pattern: { 1: 's-morning', 5: friday } },
    });
    const onRota = [assignment({ shiftId: null, rotationId: 'r-1' })];

    it('reminds when the rotation names a shift for today', async () => {
      const { service, notify } = build({ assignments: onRota, rotations: rotation('s-morning'), shifts: MORNING });
      expect((await service.remindStartingSoon(NOW)).reminded).toBe(1);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('does not remind on a rota day off', async () => {
      const { service, notify } = build({ assignments: onRota, rotations: rotation(null), shifts: MORNING });
      expect(await service.remindStartingSoon(NOW)).toMatchObject({ reminded: 0, failed: 0 });
      expect(notify).not.toHaveBeenCalled();
    });

    it('ignores a rotation that no longer exists', async () => {
      const { service } = build({ assignments: onRota, rotations: {}, shifts: MORNING });
      expect((await service.remindStartingSoon(NOW)).reminded).toBe(0);
    });
  });

  it('uses the assignment in force, not an older one', async () => {
    const { service, notify } = build({
      assignments: [
        assignment({ id: 'old', shiftId: 's-night', effectiveFrom: new Date('2026-09-01') }),
        assignment({ id: 'new', shiftId: 's-morning', effectiveFrom: new Date('2026-10-20') }),
      ],
      shifts: { 's-night': { startTime: '22:00' }, 's-morning': { startTime: '08:00' } },
    });
    expect((await service.remindStartingSoon(NOW)).reminded).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('ignores an assignment whose shift is gone or unparseable', async () => {
    const missing = build({ shifts: {} });
    const garbled = build({ shifts: { 's-morning': { startTime: 'soon' } } });
    expect((await missing.service.remindStartingSoon(NOW)).reminded).toBe(0);
    expect((await garbled.service.remindStartingSoon(NOW)).reminded).toBe(0);
  });

  it('counts a failing employee and carries on', async () => {
    const notify = jest.fn().mockRejectedValueOnce(new Error('crm down')).mockResolvedValue(undefined);
    const { service } = build({
      assignments: [assignment({ employeeId: 'e1' }), assignment({ id: 'a2', employeeId: 'e2' })],
      shifts: MORNING,
      notify,
    });
    expect(await service.remindStartingSoon(NOW)).toEqual({ reminded: 1, skipped: 0, failed: 1, ok: true });
  });

  it('reports ok=false when nothing could be sent', async () => {
    const notify = jest.fn().mockRejectedValue(new Error('crm down'));
    const { service } = build({ shifts: MORNING, notify });
    expect(await service.remindStartingSoon(NOW)).toEqual({ reminded: 0, skipped: 0, failed: 1, ok: false });
  });

  it('is not a clean idle round when no notification port is wired', async () => {
    const { service } = build({ shifts: MORNING, notify: null });
    expect(await service.remindStartingSoon(NOW)).toEqual({ reminded: 0, skipped: 0, failed: 0, ok: false });
  });

  it('does nothing in the last 45 minutes of the local day, whose window is tomorrow\'s roster', async () => {
    const lateNight = new Date('2026-10-23T16:30:00.000Z'); // 23:30 in Jakarta
    const { service, shifts } = build({ shifts: MORNING });
    expect(await service.remindStartingSoon(lateNight)).toEqual({ reminded: 0, skipped: 0, failed: 0, ok: true });
    expect(shifts.listAllAssignmentsUpTo).not.toHaveBeenCalled();
  });

  it('reads the roster for the local day it is running on', async () => {
    const { service, shifts } = build({ shifts: MORNING });
    await service.remindStartingSoon(NOW);
    expect(shifts.listAllAssignmentsUpTo).toHaveBeenCalledWith(WORK_DATE, expect.any(Number));
  });
});

describe('ShiftReminderController', () => {
  it('runs the sweep for the current instant', async () => {
    const remindStartingSoon = jest.fn().mockResolvedValue({ reminded: 2, skipped: 0, failed: 0, ok: true });
    const controller = new ShiftReminderController({ remindStartingSoon } as never);
    await expect(controller.remindStarting()).resolves.toEqual({ reminded: 2, skipped: 0, failed: 0, ok: true });
    expect(remindStartingSoon).toHaveBeenCalledWith(expect.any(Date));
  });
});
