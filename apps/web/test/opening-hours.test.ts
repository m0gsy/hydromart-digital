import { describe, expect, it } from 'vitest';

import { depotOpenState } from '@/lib/opening-hours';
import type { DepotHours } from '@/lib/types';

// SOP: 08.00–21.00, istirahat 12.00–13.00, kecuali Jumat 11.30–13.00.
const SOP: Record<string, DepotHours> = {
  mon: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
  fri: { open: '08:00', close: '21:00', breakStart: '11:30', breakEnd: '13:00' },
};

/*
 * A WIB wall clock, built as an explicit instant.
 *
 * This was `new Date(y, m - 1, d, hh, mm)` — which builds the instant in whatever timezone
 * the MACHINE is set to, with a comment saying the badge reads the viewer's own clock. That
 * was true of the code then, and it made every assertion below agree with itself only on a
 * laptop already on WIB. On the CI runner, which is UTC, `at(2026, 8, 10, 21, 0)` is 04:00
 * the next morning in Jakarta and four of these tests flipped.
 *
 * They were never testing opening hours; they were testing the author's timezone. Asia/
 * Jakarta is UTC+7 all year with no DST, so the offset is subtracted directly and the
 * instant is the same one on every machine.
 */
const WIB_OFFSET_HOURS = 7;
const at = (y: number, m: number, d: number, hh: number, mm: number): Date =>
  new Date(Date.UTC(y, m - 1, d, hh - WIB_OFFSET_HOURS, mm));

// 2026-08-10 Monday, 2026-08-14 Friday, 2026-08-11 Tuesday (no entry in SOP).
describe('depotOpenState', () => {
  it('is open inside the window', () => {
    expect(depotOpenState(SOP, [], at(2026, 8, 10, 10, 0))).toBe('buka');
  });

  it('is shut before opening and from closing time on', () => {
    expect(depotOpenState(SOP, [], at(2026, 8, 10, 7, 59))).toBe('tutup');
    expect(depotOpenState(SOP, [], at(2026, 8, 10, 21, 0))).toBe('tutup');
  });

  // The distinction the badge exists for: shut for an hour is not shut for the day.
  it('reports the midday break separately, with Friday starting earlier', () => {
    expect(depotOpenState(SOP, [], at(2026, 8, 10, 12, 30))).toBe('istirahat');
    expect(depotOpenState(SOP, [], at(2026, 8, 10, 11, 45))).toBe('buka');
    expect(depotOpenState(SOP, [], at(2026, 8, 14, 11, 45))).toBe('istirahat');
    expect(depotOpenState(SOP, [], at(2026, 8, 10, 13, 0))).toBe('buka');
  });

  it('is shut all day on a weekday with no entry and on a listed holiday', () => {
    expect(depotOpenState(SOP, [], at(2026, 8, 11, 10, 0))).toBe('tutup');
    expect(depotOpenState(SOP, [{ date: '2026-08-10' }], at(2026, 8, 10, 10, 0))).toBe('tutup');
  });

  /*
   * W11. No hours configured at all is CLOSED, not open.
   *
   * This used to answer 'buka', and so did the server copy it mirrors. The premise both
   * rested on — "a depot that never filled the form in is not permanently shut" — is not
   * how the money behaves: `expireAbandoned` auto-cancels any order still CREATED after
   * `abandonMinutes`, whatever its delivery window, so an order placed at an unstaffed
   * depot dies about an hour later with nothing said. Default-open sold that order;
   * default-closed refuses it while the customer is still on the screen.
   *
   * Configure the hours to be open. An unanswered question is not a yes.
   */
  it('says closed when no hours are configured at all', () => {
    expect(depotOpenState(undefined, undefined, at(2026, 8, 10, 3, 0))).toBe('tutup');
    expect(depotOpenState({}, [], at(2026, 8, 10, 3, 0))).toBe('tutup');
  });

  it('says open rather than guessing on an unreadable or half-set entry', () => {
    expect(depotOpenState({ mon: { open: 'pagi', close: '21:00' } }, [], at(2026, 8, 10, 3, 0))).toBe(
      'buka',
    );
    // close <= open is an overnight depot, not a negative window.
    expect(depotOpenState({ mon: { open: '21:00', close: '08:00' } }, [], at(2026, 8, 10, 3, 0))).toBe(
      'buka',
    );
    // Only half a break configured — ignored, not treated as closed from noon.
    expect(
      depotOpenState({ mon: { open: '08:00', close: '21:00', breakStart: '12:00' } }, [], at(2026, 8, 10, 12, 30)),
    ).toBe('buka');
  });
});

/*
 * The depot's clock, not the viewer's — and since W11 that difference spends money.
 *
 * order-service answers with `isOpenAt(..., config.businessTimeZone)`. This copy read
 * `now.getHours()`, the device's own clock. While the answer only picked a badge word the two
 * could disagree harmlessly; now it also disables the pay button, so a phone on WITA/WIT, or
 * one with a wrong clock, or a browser abroad, refuses an order the server would accept.
 *
 * CI found it before a customer did: the runner's clock is UTC, the seeded depot opens
 * 08:00-20:00 WIB, and at 20:41 UTC the checkout E2E could not submit. One wall clock, two
 * answers.
 */
describe('depotOpenState reads the depot clock, not the device clock', () => {
  const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const hours = Object.fromEntries(WEEK.map((d) => [d, { open: '08:00', close: '20:00' }]));

  it('is OPEN at 20:41 UTC, which is 03:41 the next day in WIB', () => {
    // The exact instant the E2E run died. In WIB this is 03:41 — outside 08:00-20:00 — so the
    // depot really is shut, and the badge must say so for a reason that is TRUE.
    expect(depotOpenState(hours, [], new Date('2026-08-29T20:41:00Z'))).toBe('tutup');
  });

  it('is open at 09:00 WIB however the viewer device is set', () => {
    // 02:00 UTC = 09:00 WIB. Under the old code a device on UTC read 02:00 and said `tutup`,
    // and a device on WIB read 09:00 and said `buka` — same depot, same moment.
    expect(depotOpenState(hours, [], new Date('2026-08-30T02:00:00Z'))).toBe('buka');
  });

  it('is shut at 21:00 WIB even for a viewer whose device says 14:00', () => {
    // 14:00 UTC = 21:00 WIB, an hour past closing. The device clock would have sold this one.
    expect(depotOpenState(hours, [], new Date('2026-08-30T14:00:00Z'))).toBe('tutup');
  });

  it('picks the holiday by the depot day, not the viewer day', () => {
    // 17:30 UTC on the 30th is already 00:30 on the 31st in WIB. A viewer on UTC would have
    // matched the 30th's holiday row and missed the 31st's.
    const holidays = [{ date: '2026-08-31', label: 'Libur' }];
    expect(depotOpenState(hours, holidays, new Date('2026-08-30T17:30:00Z'))).toBe('tutup');
    expect(depotOpenState(hours, [], new Date('2026-08-30T17:30:00Z'))).toBe('tutup');
  });

  it('picks the WEEKDAY by the depot day too', () => {
    // Sunday 17:30 UTC is already Monday in WIB. Only Monday is open here.
    const monOnly = { mon: { open: '00:00', close: '23:59' } };
    expect(depotOpenState(monOnly, [], new Date('2026-08-30T17:30:00Z'))).toBe('buka');
    expect(depotOpenState(monOnly, [], new Date('2026-08-30T10:00:00Z'))).toBe('tutup');
  });
});
