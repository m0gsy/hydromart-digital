import { workingDaysInRange, parseWeeklyOffDays } from '../../src/domain/calendar';
import { scheduleOf, ScheduleInput } from '../../src/domain/scheduled-days';
import { RotationPattern } from '../../src/domain/shift-rotation';

/* HD-6 H-02, choice 35A: the scheduled-days rule, and that it is the rule payroll's expected days follow. */
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const base: ScheduleInput = {
  from: '2026-11-01',
  to: '2026-11-30',
  joinDay: '2026-01-01',
  exitDay: null,
  assignments: [],
  patterns: new Map(),
  ownShift: false,
  weeklyOffCsv: '0',
  holidays: new Set(),
};

describe('scheduleOf', () => {
  it('follows a rotation week: a blank weekday is a rest day, not the depot rest day', () => {
    const r = scheduleOf({
      ...base,
      to: '2026-11-08',
      assignments: [{ shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-10-01') }],
      patterns: new Map([['r1', { 0: 'S', 1: null, 2: 'S', 6: 'S' }]]), // Sun, Tue, Sat; Monday blank
    });
    expect(r.scheduled).toEqual(['2026-11-01', '2026-11-03', '2026-11-07', '2026-11-08']);
    expect(r.unscheduled).toEqual([]);
  });

  it('drops a holiday, for a rotation and a fixed shift alike', () => {
    const holidays = new Set(['2026-11-03']);
    const fixed = scheduleOf({ ...base, to: '2026-11-04', ownShift: true, holidays });
    expect(fixed.scheduled).toEqual(['2026-11-02', '2026-11-04']);
    const rota = scheduleOf({
      ...base,
      to: '2026-11-04',
      holidays,
      assignments: [{ shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-10-01') }],
      patterns: new Map([['r1', { 1: 'S', 2: 'S', 3: 'S' }]]),
    });
    expect(rota.scheduled).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('counts an employee with no shift apart, on the depot workdays, and never as scheduled', () => {
    const r = scheduleOf({ ...base, to: '2026-11-08' });
    expect(r.scheduled).toEqual([]);
    expect(r.unscheduled).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  });

  it('counts only the days between joining and leaving, both included', () => {
    const r = scheduleOf({ ...base, ownShift: true, joinDay: '2026-11-04', exitDay: '2026-11-06' });
    expect(r.scheduled).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(scheduleOf({ ...base, ownShift: true, joinDay: '2026-12-01' }).scheduled).toEqual([]);
  });

  it('uses the assignment in force on each day, the later one winning a tie', () => {
    const r = scheduleOf({
      ...base,
      to: '2026-11-06',
      assignments: [
        { shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-11-01') },
        { shiftId: null, rotationId: 'r2', effectiveFrom: day('2026-11-04') },
        { shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-11-04') }, // a correction entered afterwards
      ],
      patterns: new Map<string, RotationPattern>([
        ['r1', { 1: 'S', 4: 'S' }],
        ['r2', { 3: 'S', 5: 'S' }],
      ]),
    });
    expect(r.scheduled).toEqual(['2026-11-02', '2026-11-05']);
  });

  it('agrees with the days payroll expects of a fixed-shift employee in the month', () => {
    const holidays = new Set(['2026-11-10', '2026-11-27']);
    const payroll = workingDaysInRange('2026-11-01', '2026-11-30', holidays, parseWeeklyOffDays('0,6'));
    expect(scheduleOf({ ...base, ownShift: true, weeklyOffCsv: '0,6', holidays }).scheduled).toEqual(payroll);
  });
});
