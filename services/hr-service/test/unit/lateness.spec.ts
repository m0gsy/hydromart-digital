import { latenessFor } from '../../src/domain/lateness';

/**
 * D7 — a night shift could never be late.
 *
 * Lateness was `minutesOfDay > startMinutes + tolerance`, both measured on the SAME
 * `workDate`. A shift starting 22:00 (1320) punched at 00:10 (10) gives `10 > 1320 + 15`
 * = false, so `lateMinutes` is 0 and the row is filed PRESENT — two hours and ten minutes
 * late, recorded as on time, and no fine ever reaches the payslip.
 */
describe('latenessFor', () => {
  const TOL = 15;

  it('is not late when the punch is inside the tolerance', () => {
    // 07:50 shift, arrives 07:59.
    expect(latenessFor({ minutesOfDay: 479, startMinutes: 470, toleranceMinutes: TOL })).toEqual({
      late: false,
      lateMinutes: 0,
    });
  });

  it('measures from the shift start, tolerance included, once tolerance is exceeded', () => {
    // The trap worth keeping pinned: 07:50 shift, arrives 08:10 = 20 minutes, not 5.
    expect(latenessFor({ minutesOfDay: 490, startMinutes: 470, toleranceMinutes: TOL })).toEqual({
      late: true,
      lateMinutes: 20,
    });
  });

  it('counts a post-midnight punch against the shift that started the evening before', () => {
    // 22:00 shift, punched 00:10. The defect: this used to be "not late at all".
    expect(latenessFor({ minutesOfDay: 10, startMinutes: 1320, toleranceMinutes: TOL })).toEqual({
      late: true,
      lateMinutes: 130,
    });
  });

  it('leaves an early punch for a night shift early, not 22 hours late', () => {
    // 22:00 shift, punched 21:45.
    expect(latenessFor({ minutesOfDay: 1305, startMinutes: 1320, toleranceMinutes: TOL })).toEqual({
      late: false,
      lateMinutes: 0,
    });
  });

  it('does NOT forgive someone who is genuinely more than twelve hours late', () => {
    // 08:00 shift, punched 21:00. A symmetric wrap would call this "3 hours early" and
    // erase a 13-hour lateness — which is why the wrap is one-directional on purpose.
    expect(latenessFor({ minutesOfDay: 1260, startMinutes: 480, toleranceMinutes: TOL })).toEqual({
      late: true,
      lateMinutes: 780,
    });
  });

  it('treats a punch exactly at the shift start as on time', () => {
    expect(latenessFor({ minutesOfDay: 480, startMinutes: 480, toleranceMinutes: 0 })).toEqual({
      late: false,
      lateMinutes: 0,
    });
  });

  it('handles a zero tolerance without turning one minute into none', () => {
    expect(latenessFor({ minutesOfDay: 481, startMinutes: 480, toleranceMinutes: 0 })).toEqual({
      late: true,
      lateMinutes: 1,
    });
  });
});
