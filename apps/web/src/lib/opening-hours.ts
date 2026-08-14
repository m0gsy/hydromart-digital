// Is a depot serving right now? Mirrors services/order-service/src/domain/opening-hours.ts,
// which is the authority — the server decides whether "antar sekarang" is actually on offer.
// This copy only decides what the badge says, and must answer the same way so the two never
// contradict each other on screen.

import type { DepotHoliday, DepotHours } from '@/lib/types';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function minutesOf(hhmm: string | undefined): number | null {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export type DepotOpenState = 'buka' | 'istirahat' | 'tutup';

/**
 * Open / on its break / shut, in the viewer's own clock.
 *
 * No hours configured at all → 'buka'. A depot that never filled the form in is not a
 * depot that is permanently closed, and rendering "Tutup" over every existing depot is
 * the loud way to get that wrong.
 */
export function depotOpenState(
  hours: Record<string, DepotHours> | null | undefined,
  holidays: DepotHoliday[] | null | undefined,
  now: Date = new Date(),
): DepotOpenState {
  if (!hours || Object.keys(hours).length === 0) return 'buka';

  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  if (holidays?.some((h) => h?.date === day)) return 'tutup';

  const today = hours[DAY_KEYS[now.getDay()] as string];
  if (!today) return 'tutup';

  const open = minutesOf(today.open);
  const close = minutesOf(today.close);
  if (open === null || close === null || close <= open) return 'buka';

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < open || nowMinutes >= close) return 'tutup';

  const breakStart = minutesOf(today.breakStart);
  const breakEnd = minutesOf(today.breakEnd);
  if (breakStart !== null && breakEnd !== null && breakEnd > breakStart) {
    if (nowMinutes >= breakStart && nowMinutes < breakEnd) return 'istirahat';
  }
  return 'buka';
}

/** Dictionary keys — the three words a customer reads on every depot card. */
export const DEPOT_OPEN_LABEL: Record<DepotOpenState, string> = {
  buka: 'customerFix.depotOpen.buka',
  istirahat: 'customerFix.depotOpen.istirahat',
  tutup: 'customerFix.depotOpen.tutup',
};
