import { isOpenAt, type OperatingHours } from '../../src/domain/opening-hours';

const TZ = 'Asia/Jakarta';
// SOP: 08.00–21.00 setiap hari, istirahat 12.00–13.00, kecuali Jumat 11.30–13.00.
const SOP: OperatingHours = {
  mon: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
  tue: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
  wed: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
  thu: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
  fri: { open: '08:00', close: '21:00', breakStart: '11:30', breakEnd: '13:00' },
  sat: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
};

/** A WIB wall-clock time as the instant it really is (WIB = UTC+7). */
const wib = (day: string, hhmm: string): Date => new Date(`${day}T${hhmm}:00.000+07:00`);

// 2026-08-10 is a Monday; 2026-08-14 is a Friday; 2026-08-09 is a Sunday.
const MON = '2026-08-10';
const FRI = '2026-08-14';
const SUN = '2026-08-09';

describe('isOpenAt', () => {
  it('is open at the opening minute and shut the minute before', () => {
    expect(isOpenAt(SOP, [], wib(MON, '07:59'), TZ)).toBe(false);
    expect(isOpenAt(SOP, [], wib(MON, '08:00'), TZ)).toBe(true);
  });

  it('is open up to closing time, exclusive', () => {
    expect(isOpenAt(SOP, [], wib(MON, '20:59'), TZ)).toBe(true);
    expect(isOpenAt(SOP, [], wib(MON, '21:00'), TZ)).toBe(false);
    expect(isOpenAt(SOP, [], wib(MON, '21:01'), TZ)).toBe(false);
  });

  // The one case a single global break time gets wrong.
  it('is open at 11.45 on Monday but on its break at 11.45 on Friday', () => {
    expect(isOpenAt(SOP, [], wib(MON, '11:45'), TZ)).toBe(true);
    expect(isOpenAt(SOP, [], wib(FRI, '11:45'), TZ)).toBe(false);
  });

  it('reopens at the end of the break', () => {
    expect(isOpenAt(SOP, [], wib(MON, '12:00'), TZ)).toBe(false);
    expect(isOpenAt(SOP, [], wib(MON, '12:59'), TZ)).toBe(false);
    expect(isOpenAt(SOP, [], wib(MON, '13:00'), TZ)).toBe(true);
  });

  it('is shut all day on a weekday with no entry (SOP has no Sunday)', () => {
    expect(isOpenAt(SOP, [], wib(SUN, '10:00'), TZ)).toBe(false);
  });

  it('is shut all day on a listed holiday', () => {
    expect(isOpenAt(SOP, [{ date: MON, label: 'HUT RI' }], wib(MON, '10:00'), TZ)).toBe(false);
    expect(isOpenAt(SOP, [{ date: '2026-08-17' }], wib(MON, '10:00'), TZ)).toBe(true);
  });

  // Reads the clock in the DEPOT's zone, not the server's. 2026-08-10T22:30Z is already
  // Tuesday 05:30 in WIB — before opening — while UTC still calls it Monday evening.
  it('reads the wall clock in the depot time zone', () => {
    expect(isOpenAt(SOP, [], new Date('2026-08-10T22:30:00.000Z'), TZ)).toBe(false);
    expect(isOpenAt(SOP, [], new Date('2026-08-10T03:00:00.000Z'), TZ)).toBe(true); // 10:00 WIB
  });

  /**
   * W11. This used to answer `true`, on the reasoning that an empty blob is a depot that
   * never filled the form in rather than one that is permanently shut. Measured against
   * production, that reading sells: depot DEMO-01 "Depot Demo (Play Review)" is ACTIVE and
   * public in Malang with `operatingHours: {}`, so every customer inside its 3 km radius
   * could buy an immediate cash delivery from it at 03.00. Absence is not a safe value —
   * the same call the Prometheus alerting rules had to make.
   *
   * Note what this is NOT: an unreachable depot-service still reads as open (order.service
   * `depotIsOpen`). Not knowing and knowing that nothing is configured are different facts.
   */
  it('treats "no hours configured" as SHUT, not as open forever', () => {
    expect(isOpenAt(null, [], wib(MON, '03:00'), TZ)).toBe(false);
    expect(isOpenAt(undefined, null, wib(MON, '03:00'), TZ)).toBe(false);
    expect(isOpenAt({}, [], wib(MON, '03:00'), TZ)).toBe(false);
    // Even at what would be the middle of a normal trading day: the depot has not said it
    // trades at all, and a slot nobody configured is not a slot.
    expect(isOpenAt({}, [], wib(MON, '10:00'), TZ)).toBe(false);
  });

  // A depot that HAS filled the form in is untouched by the flip above — the two real
  // Bekasi depots trade 08.00–21.00 and keep every answer they had.
  it('leaves a configured depot exactly as it was', () => {
    expect(isOpenAt(SOP, [], wib(MON, '10:00'), TZ)).toBe(true);
    expect(isOpenAt(SOP, [], wib(MON, '22:00'), TZ)).toBe(false);
  });

  it('treats an unreadable or inverted window as open rather than guessing', () => {
    const junk: OperatingHours = { mon: { open: 'pagi', close: '21:00' } };
    expect(isOpenAt(junk, [], wib(MON, '03:00'), TZ)).toBe(true);
    expect(isOpenAt({ mon: { open: '08:00', close: '99:99' } }, [], wib(MON, '03:00'), TZ)).toBe(true);
    // close <= open: an overnight depot, not a negative window.
    expect(isOpenAt({ mon: { open: '21:00', close: '08:00' } }, [], wib(MON, '03:00'), TZ)).toBe(true);
  });

  it('ignores a half-set or inverted break', () => {
    const halfSet: OperatingHours = { mon: { open: '08:00', close: '21:00', breakStart: '12:00' } };
    expect(isOpenAt(halfSet, [], wib(MON, '12:30'), TZ)).toBe(true);
    const inverted: OperatingHours = {
      mon: { open: '08:00', close: '21:00', breakStart: '13:00', breakEnd: '12:00' },
    };
    expect(isOpenAt(inverted, [], wib(MON, '12:30'), TZ)).toBe(true);
  });
});
