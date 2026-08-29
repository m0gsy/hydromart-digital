// Is a depot serving right now? Mirrors services/order-service/src/domain/opening-hours.ts,
// which is the authority — the server decides whether "antar sekarang" is actually on offer.
// This copy only decides what the badge says, and must answer the same way so the two never
// contradict each other on screen.
//
// TWO COPIES OF ONE RULE, and they have already drifted once: the empty-config default was
// 'buka' here and `true` there, and both were wrong, so W11 had to change them in two
// places at once. Nothing makes that impossible to get wrong again. The rule is pure and
// takes no Nest/React anything, so it belongs in `packages/` with both sides importing it
// — see needs_outside_files.

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
 * No hours configured at all → 'tutup'. This answered 'buka' until W11, on the premise
 * that a depot which never filled the form in is not permanently shut. The money says
 * otherwise: order-service's `expireAbandoned` auto-cancels any order still CREATED after
 * `abandonMinutes` — it sweeps on the age of the row, not on the delivery window — so an
 * order placed at an unstaffed depot is silently gone about an hour later. Default-open
 * sold that order; default-closed declines it while the customer is still looking.
 *
 * An unanswered question is not a yes. The fix for a depot showing "Tutup" is to fill the
 * hours in, and that is a form somebody can reach.
 */
export function depotOpenState(
  hours: Record<string, DepotHours> | null | undefined,
  holidays: DepotHoliday[] | null | undefined,
  now: Date = new Date(),
): DepotOpenState {
  if (!hours || Object.keys(hours).length === 0) return 'tutup';

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
