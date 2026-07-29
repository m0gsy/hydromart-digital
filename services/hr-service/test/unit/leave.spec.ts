import {
  BLOCKING_STATUSES,
  deductsQuota,
  leaveWorkingDays,
  nextStatus,
  rangesOverlap,
} from '../../src/domain/leave';
import { workingDaysInMonth, workingDaysInRange } from '../../src/domain/calendar';

const NONE = new Set<string>();
const NO_OFF = new Set<number>();
const SUNDAY = new Set([0]);

describe('deductsQuota', () => {
  it('charges annual and permission leave, never sickness or an emergency', () => {
    expect(deductsQuota('ANNUAL')).toBe(true);
    expect(deductsQuota('PERMISSION')).toBe(true);
    expect(deductsQuota('SICK')).toBe(false);
    expect(deductsQuota('EMERGENCY')).toBe(false);
  });
});

describe('leaveWorkingDays', () => {
  it('counts a plain weekday range day by day', () => {
    // Mon 2026-07-06 → Fri 2026-07-10
    expect(leaveWorkingDays('2026-07-06', '2026-07-10', NONE, NO_OFF)).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ]);
  });

  it('does not charge a national holiday inside the range', () => {
    const days = leaveWorkingDays('2026-07-06', '2026-07-10', new Set(['2026-07-08']), NO_OFF);
    expect(days).not.toContain('2026-07-08');
    expect(days).toHaveLength(4);
  });

  it('does not charge a weekly-off day inside the range', () => {
    // 2026-07-05 and 2026-07-12 are Sundays.
    const days = leaveWorkingDays('2026-07-04', '2026-07-13', NONE, SUNDAY);
    expect(days).not.toContain('2026-07-05');
    expect(days).not.toContain('2026-07-12');
    expect(days).toHaveLength(8);
  });

  it('is a single day when start and end are the same working day', () => {
    expect(leaveWorkingDays('2026-07-06', '2026-07-06', NONE, NO_OFF)).toEqual(['2026-07-06']);
  });

  it('yields nothing for an inverted range or a range with no working day', () => {
    expect(leaveWorkingDays('2026-07-10', '2026-07-06', NONE, NO_OFF)).toEqual([]);
    expect(leaveWorkingDays('2026-07-05', '2026-07-05', NONE, SUNDAY)).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(leaveWorkingDays('2026-07-30', '2026-08-03', NONE, NO_OFF)).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });
});

describe('workingDaysInMonth still agrees with the range helper', () => {
  it('counts July 2026 the same either way', () => {
    expect(workingDaysInMonth(2026, 7, new Set(['2026-07-17']), SUNDAY)).toBe(
      workingDaysInRange('2026-07-01', '2026-07-31', new Set(['2026-07-17']), SUNDAY).length,
    );
  });

  it('counts February in a leap year', () => {
    expect(workingDaysInMonth(2028, 2, NONE, NO_OFF)).toBe(29);
  });
});

describe('rangesOverlap', () => {
  it('detects containment, partial overlap, and a shared edge', () => {
    expect(rangesOverlap('2026-07-06', '2026-07-10', '2026-07-07', '2026-07-08')).toBe(true);
    expect(rangesOverlap('2026-07-06', '2026-07-10', '2026-07-09', '2026-07-15')).toBe(true);
    expect(rangesOverlap('2026-07-06', '2026-07-10', '2026-07-10', '2026-07-11')).toBe(true);
  });

  it('separates ranges that only touch by a gap', () => {
    expect(rangesOverlap('2026-07-06', '2026-07-10', '2026-07-11', '2026-07-12')).toBe(false);
    expect(rangesOverlap('2026-07-06', '2026-07-10', '2026-07-01', '2026-07-05')).toBe(false);
  });
});

describe('nextStatus', () => {
  it('walks the happy path manager → HR → approved', () => {
    expect(nextStatus('PENDING_MANAGER', 'MANAGER_APPROVE')).toBe('PENDING_HR');
    expect(nextStatus('PENDING_HR', 'HR_APPROVE')).toBe('APPROVED');
  });

  it('rejects at either stage', () => {
    expect(nextStatus('PENDING_MANAGER', 'MANAGER_REJECT')).toBe('REJECTED');
    expect(nextStatus('PENDING_HR', 'HR_REJECT')).toBe('REJECTED');
  });

  it('lets the employee cancel while pending, at either stage', () => {
    expect(nextStatus('PENDING_MANAGER', 'CANCEL')).toBe('CANCELLED');
    expect(nextStatus('PENDING_HR', 'CANCEL')).toBe('CANCELLED');
  });

  it('refuses to skip the manager stage', () => {
    expect(nextStatus('PENDING_MANAGER', 'HR_APPROVE')).toBeNull();
    expect(nextStatus('PENDING_MANAGER', 'HR_REJECT')).toBeNull();
  });

  it('refuses a second manager decision', () => {
    expect(nextStatus('PENDING_HR', 'MANAGER_APPROVE')).toBeNull();
  });

  it('treats approved, rejected and cancelled as terminal', () => {
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(nextStatus(status, 'HR_APPROVE')).toBeNull();
      expect(nextStatus(status, 'MANAGER_APPROVE')).toBeNull();
      expect(nextStatus(status, 'CANCEL')).toBeNull();
    }
  });
});

describe('BLOCKING_STATUSES', () => {
  it('holds the days while pending or approved, and only those', () => {
    expect([...BLOCKING_STATUSES]).toEqual(['PENDING_MANAGER', 'PENDING_HR', 'APPROVED']);
  });
});
