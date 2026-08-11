import { describe, expect, it } from 'vitest';

import { depotOpenState } from '@/lib/opening-hours';
import type { DepotHours } from '@/lib/types';

// SOP: 08.00–21.00, istirahat 12.00–13.00, kecuali Jumat 11.30–13.00.
const SOP: Record<string, DepotHours> = {
  mon: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' },
  fri: { open: '08:00', close: '21:00', breakStart: '11:30', breakEnd: '13:00' },
};

/** Local wall clock — the badge reads the viewer's own clock, so the test does too. */
const at = (y: number, m: number, d: number, hh: number, mm: number): Date =>
  new Date(y, m - 1, d, hh, mm);

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

  // A depot that never filled the form in is not a depot that is permanently closed.
  it('says open when no hours are configured at all', () => {
    expect(depotOpenState(undefined, undefined, at(2026, 8, 10, 3, 0))).toBe('buka');
    expect(depotOpenState({}, [], at(2026, 8, 10, 3, 0))).toBe('buka');
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
