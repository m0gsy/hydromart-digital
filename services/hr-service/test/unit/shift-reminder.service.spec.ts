import { ShiftReminderService } from '../../src/application/services/shift-reminder.service';
import { ShiftReminderController } from '../../src/modules/shift-reminder.controller';

// 2026-10-23 (a Friday) 07:25 in Jakarta is 00:25 UTC. Shifts starting 07:40-08:10 are due.
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
  holidays?: string[] | 'none';
  claim?: boolean;
}) {
  const notify = opts.notify === undefined ? jest.fn(async () => undefined) : opts.notify;
  const shifts = {
    listAllAssignmentsUpTo: jest.fn(async () => opts.assignments ?? [assignment({})]),
    findById: jest.fn(async (id: string) => opts.shifts?.[id] ?? null),
    findRotationById: jest.fn(async (id: string) => opts.rotations?.[id] ?? null),
    claimShiftReminder: jest.fn(async () => opts.claim ?? true),
  };
  const holidayDates = jest.fn(async (_depot: string | null, from: Date) =>
    (opts.holidays === 'none' || opts.holidays === undefined ? [] : opts.holidays).filter(
      (d) => d === from.toISOString().slice(0, 10),
    ),
  );
  const attendance = { findByEmployeeAndDate: jest.fn(async () => opts.attendance ?? null) };
  const employees = {
    findByIdInternal: jest.fn(async () =>
      opts.employee === null
        ? null
        : {
            id: 'e1',
            depotId: 'depot-1',
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
    opts.holidays === 'none' || opts.holidays === undefined
      ? undefined
      : ({ listDates: holidayDates } as never),
  );
  return { service, notify, shifts, attendance, employees, holidayDates };
}

const MORNING = { 's-morning': { startTime: '08:00' } };

describe('ShiftReminderService', () => {
  it('reminds a rota employee whose shift starts within the next 15-45 minutes', async () => {
    const { service, notify } = build({ shifts: MORNING });
    expect(await service.remindStartingSoon(NOW)).toEqual({
      reminded: 1,
      skipped: 0,
      failed: 0,
      ok: true,
    });
    expect(notify).toHaveBeenCalledWith('SHIFT_REMINDER', '0811', { name: 'Budi', time: '08:00' }, 'acct-1');
  });

  it('catches a shift a skipped tick left unreminded, down to 15 minutes before', async () => {
    const soon = build({ shifts: { 's-morning': { startTime: '07:45' } } });
    expect((await soon.service.remindStartingSoon(NOW)).reminded).toBe(1);
  });

  it('says it once however often a shift is seen', async () => {
    const { service, shifts, notify } = build({ shifts: MORNING });
    await service.remindStartingSoon(NOW);
    shifts.claimShiftReminder.mockResolvedValue(false);
    await service.remindStartingSoon(new Date(NOW.getTime() + 15 * 60_000));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('claims before sending, and sends nothing when another sweep holds the claim', async () => {
    const { service, notify, shifts } = build({ shifts: MORNING, claim: false });
    expect(await service.remindStartingSoon(NOW)).toMatchObject({ reminded: 0, skipped: 1 });
    expect(shifts.claimShiftReminder).toHaveBeenCalledWith('e1', WORK_DATE);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not claim a day it skipped, so a later tick can still remind', async () => {
    const { service, shifts } = build({ shifts: MORNING, holidays: ['2026-10-23'] });
    await service.remindStartingSoon(NOW);
    expect(shifts.claimShiftReminder).not.toHaveBeenCalled();
  });

  it('leaves shifts outside the window', async () => {
    const early = build({ shifts: { 's-morning': { startTime: '07:35' } } });
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

  describe('public holidays', () => {
    it('does not remind on a holiday for the employee depot', async () => {
      const { service, notify, holidayDates } = build({ shifts: MORNING, holidays: ['2026-10-23'] });
      expect(await service.remindStartingSoon(NOW)).toMatchObject({ reminded: 0, skipped: 1 });
      expect(notify).not.toHaveBeenCalled();
      expect(holidayDates).toHaveBeenCalledWith('depot-1', WORK_DATE, WORK_DATE);
    });

    it('still reminds on an ordinary day', async () => {
      const { service } = build({ shifts: MORNING, holidays: ['2026-12-25'] });
      expect((await service.remindStartingSoon(NOW)).reminded).toBe(1);
    });
  });

  // 23:40 in Jakarta is 16:40 UTC. The window (00:10-00:25 local) belongs to TOMORROW's roster.
  describe('across midnight', () => {
    const LATE = new Date('2026-10-23T16:40:00.000Z');
    const TOMORROW = new Date('2026-10-24T00:00:00.000Z');

    it('reminds a 00:10 shift the evening before, reading tomorrow\'s roster', async () => {
      const { service, notify, shifts } = build({ shifts: { 's-morning': { startTime: '00:10' } } });
      expect((await service.remindStartingSoon(LATE)).reminded).toBe(1);
      expect(notify).toHaveBeenCalledWith('SHIFT_REMINDER', '0811', { name: 'Budi', time: '00:10' }, 'acct-1');
      expect(shifts.listAllAssignmentsUpTo).toHaveBeenCalledWith(TOMORROW, expect.any(Number));
    });

    it('splits a window that straddles midnight between the two days', async () => {
      // 23:20 local: the window is 23:50-00:05, half tonight and half tomorrow.
      const straddle = new Date('2026-10-23T16:20:00.000Z');
      const evening = build({ shifts: { 's-morning': { startTime: '23:55' } } });
      const early = build({ shifts: { 's-morning': { startTime: '00:02' } } });
      expect((await evening.service.remindStartingSoon(straddle)).reminded).toBe(1);
      expect((await early.service.remindStartingSoon(straddle)).reminded).toBe(1);
    });

    it('checks the next day for attendance and holidays, not today', async () => {
      const { service, attendance, holidayDates } = build({
        shifts: { 's-morning': { startTime: '00:10' } },
        holidays: ['2026-10-24'],
      });
      expect(await service.remindStartingSoon(LATE)).toMatchObject({ reminded: 0, skipped: 1 });
      expect(attendance.findByEmployeeAndDate).toHaveBeenCalledWith('e1', TOMORROW);
      expect(holidayDates).toHaveBeenCalledWith('depot-1', TOMORROW, TOMORROW);
    });

    it('does not remind a shift that starts well after the window tomorrow', async () => {
      const { service } = build({ shifts: { 's-morning': { startTime: '08:00' } } });
      expect((await service.remindStartingSoon(LATE)).reminded).toBe(0);
    });
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
