import {
  assignmentInForce,
  parseRotationPattern,
  resolveShiftStart,
  shiftIdForDay,
  shiftSpanMinutes,
} from '../../src/domain/shift-rotation';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// CA-1-38: payroll needs the LENGTH of the shift HR rostered, not just its start.
describe('shiftSpanMinutes', () => {
  it('measures the clock span of an ordinary shift', () => {
    expect(shiftSpanMinutes('08:00', '17:00')).toBe(540);
    expect(shiftSpanMinutes('08:30', '16:00')).toBe(450);
  });

  it('wraps a night shift past midnight instead of going negative', () => {
    expect(shiftSpanMinutes('22:00', '06:00')).toBe(480);
  });

  it('reads a malformed time as no shift at all, never as a zero-hour day', () => {
    expect(shiftSpanMinutes('pagi', '17:00')).toBe(0);
    expect(shiftSpanMinutes('08:00', '')).toBe(0);
  });
});

describe('rotation pattern (C3)', () => {
  it('keeps weekday keys and drops anything else', () => {
    expect(parseRotationPattern({ '0': 's0', '6': 's6', '7': 'x', '-1': 'x', abc: 'x' })).toEqual({
      0: 's0',
      6: 's6',
    });
  });

  it('treats a blank or non-string value as a day off, never as a shift', () => {
    expect(parseRotationPattern({ '1': '', '2': '  ', '3': null, '4': 42 })).toEqual({
      1: null,
      2: null,
      3: null,
      4: null,
    });
  });

  it('survives junk from the Json column instead of throwing mid-punch', () => {
    for (const junk of [null, undefined, 'string', 42, ['a'], true]) {
      expect(parseRotationPattern(junk)).toEqual({});
    }
  });
});

describe('assignment in force (C3)', () => {
  const a = { shiftId: 'sA', rotationId: null, effectiveFrom: day('2026-01-01') };
  const b = { shiftId: 'sB', rotationId: null, effectiveFrom: day('2026-06-01') };

  it('picks the latest assignment that had already started', () => {
    expect(assignmentInForce([a, b], day('2026-03-15'))).toBe(a);
    expect(assignmentInForce([a, b], day('2026-06-01'))).toBe(b);
    expect(assignmentInForce([a, b], day('2026-12-31'))).toBe(b);
  });

  it('ignores assignments that have not started yet', () => {
    expect(assignmentInForce([b], day('2026-01-01'))).toBeNull();
    expect(assignmentInForce([], day('2026-01-01'))).toBeNull();
  });

  it('lets a correction entered later win a same-date tie', () => {
    const fix = { shiftId: 'sFix', rotationId: null, effectiveFrom: day('2026-06-01') };
    expect(assignmentInForce([b, fix], day('2026-06-02'))).toBe(fix);
  });

  it('does not depend on the order it was handed the rows', () => {
    expect(assignmentInForce([b, a], day('2026-03-15'))).toBe(a);
  });
});

describe('shift for a day (C3)', () => {
  it('a fixed assignment is the same shift every day', () => {
    const fixed = { shiftId: 'sA', rotationId: null, effectiveFrom: day('2026-01-01') };
    expect(shiftIdForDay(fixed, null, day('2026-08-03'))).toBe('sA');
    expect(shiftIdForDay(fixed, null, day('2026-08-09'))).toBe('sA');
  });

  it('a rotation reads the weekday, 0 = Sunday', () => {
    const rot = { shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-01-01') };
    const pattern = parseRotationPattern({ '1': 'pagi', '2': 'malam' });
    expect(shiftIdForDay(rot, pattern, day('2026-08-03'))).toBe('pagi'); // Monday
    expect(shiftIdForDay(rot, pattern, day('2026-08-04'))).toBe('malam'); // Tuesday
    // Wednesday is not in the pattern: a day off, not a guess.
    expect(shiftIdForDay(rot, pattern, day('2026-08-05'))).toBeNull();
  });

  it('is null with no assignment, or a rotation whose pattern never loaded', () => {
    expect(shiftIdForDay(null, null, day('2026-08-03'))).toBeNull();
    const rot = { shiftId: null, rotationId: 'r1', effectiveFrom: day('2026-01-01') };
    expect(shiftIdForDay(rot, null, day('2026-08-03'))).toBeNull();
    const neither = { shiftId: null, rotationId: null, effectiveFrom: day('2026-01-01') };
    expect(shiftIdForDay(neither, { 1: 'pagi' }, day('2026-08-03'))).toBeNull();
  });
});

describe('shift start precedence (C3)', () => {
  const base = {
    assignedShiftStart: null,
    employeeShiftStart: null,
    depotShiftStart: null,
    configStartTime: '08:00',
  };

  it('prefers the employee’s assignment over everything else', () => {
    expect(
      resolveShiftStart({
        assignedShiftStart: '06:00',
        employeeShiftStart: '07:00',
        depotShiftStart: '09:00',
        configStartTime: '08:00',
      }),
    ).toEqual({ startTime: '06:00', source: 'employee-assignment' });
  });

  it('falls to the employee’s own shiftId, then the depot shift', () => {
    expect(
      resolveShiftStart({ ...base, employeeShiftStart: '07:00', depotShiftStart: '09:00' }),
    ).toEqual({ startTime: '07:00', source: 'employee-shift' });
    expect(resolveShiftStart({ ...base, depotShiftStart: '09:00' })).toEqual({
      startTime: '09:00',
      source: 'depot-shift',
    });
  });

  it('lands on the configured start when nothing else is set — zero regression', () => {
    // This is exactly what the service did before rotations existed.
    expect(resolveShiftStart(base)).toEqual({ startTime: '08:00', source: 'config' });
  });
});
