import {
  EXPRESS_WINDOW,
  RESCHEDULE_CUTOFF_MINUTES,
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_MIN_LEAD_MINUTES,
  slotStartMinutes,
  validateSchedule,
  wibMinutesOfDay,
} from '../../src/domain/delivery-schedule';

// The depot's slots are wall-clock windows in Jakarta time ("09.00-11.00"); the order stores a
// real instant. 2026-08-31 02:00Z is 09:00 WIB.
const SLOTS = ['09.00-11.00', '11.00-13.00', '15.30-17.30'];
const NOW = new Date('2026-08-31T01:00:00Z'); // 08:00 WIB

describe('delivery schedule', () => {
  describe('slotStartMinutes', () => {
    it('reads the start of an HH.MM-HH.MM window', () => {
      expect(slotStartMinutes('09.00-11.00')).toBe(9 * 60);
      expect(slotStartMinutes('15.30-17.30')).toBe(15 * 60 + 30);
    });
    it('returns null for anything else', () => {
      expect(slotStartMinutes('')).toBeNull();
      expect(slotStartMinutes('Kam, 09.00-11.00')).toBeNull();
      expect(slotStartMinutes('25.00-26.00')).toBeNull();
    });
  });

  describe('wibMinutesOfDay', () => {
    it('is Jakarta wall-clock time, not the server zone', () => {
      expect(wibMinutesOfDay(new Date('2026-08-31T02:00:00Z'))).toBe(9 * 60);
      // 20:00Z is 03:00 the NEXT day in Jakarta.
      expect(wibMinutesOfDay(new Date('2026-08-31T20:00:00Z'))).toBe(3 * 60);
    });
  });

  describe('validateSchedule', () => {
    const at = (iso: string) => new Date(iso);

    it('accepts the start of one of the depot slots and says which one', () => {
      expect(validateSchedule({ at: at('2026-08-31T04:00:00Z'), slots: SLOTS, now: NOW })).toEqual({
        ok: true,
        slot: '11.00-13.00',
      });
      expect(validateSchedule({ at: at('2026-09-01T08:30:00Z'), slots: SLOTS, now: NOW })).toEqual({
        ok: true,
        slot: '15.30-17.30',
      });
    });

    it('refuses a time that is not the start of a slot', () => {
      expect(validateSchedule({ at: at('2026-08-31T04:15:00Z'), slots: SLOTS, now: NOW })).toEqual({
        ok: false,
        reason: 'NOT_A_SLOT',
      });
    });

    it('refuses a slot already past, or closer than the minimum lead', () => {
      // 09:00 WIB today, asked for at 10:00 WIB: already past.
      expect(
        validateSchedule({
          at: at('2026-08-31T02:00:00Z'),
          slots: SLOTS,
          now: at('2026-08-31T03:00:00Z'),
        }),
      ).toEqual({ ok: false, reason: 'TOO_SOON' });
      // 09:00 WIB is 60 min after NOW (08:00 WIB): fine. With a later NOW it is inside the lead.
      const nearly = new Date(
        at('2026-08-31T02:00:00Z').getTime() - (SCHEDULE_MIN_LEAD_MINUTES - 1) * 60000,
      );
      expect(
        validateSchedule({ at: at('2026-08-31T02:00:00Z'), slots: SLOTS, now: nearly }),
      ).toEqual({
        ok: false,
        reason: 'TOO_SOON',
      });
    });

    it('refuses a date past the booking horizon', () => {
      const far = new Date(NOW.getTime() + (SCHEDULE_HORIZON_DAYS + 1) * 86400000);
      far.setUTCHours(2, 0, 0, 0);
      expect(validateSchedule({ at: far, slots: SLOTS, now: NOW })).toEqual({
        ok: false,
        reason: 'BEYOND_HORIZON',
      });
    });

    it('refuses everything when the depot has no slots', () => {
      expect(validateSchedule({ at: at('2026-08-31T04:00:00Z'), slots: [], now: NOW })).toEqual({
        ok: false,
        reason: 'NOT_A_SLOT',
      });
    });
  });

  it('keeps the express marker byte-identical to the one the sweep matches on', () => {
    expect(EXPRESS_WINDOW).toBe('Antar sekarang (express)');
  });

  it('gives a customer two hours of notice before their own slot', () => {
    expect(RESCHEDULE_CUTOFF_MINUTES).toBe(120);
  });
});
