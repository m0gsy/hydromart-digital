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

import { BUSINESS_TZ } from '@/lib/wib';
import type { DepotHoliday, DepotHours } from '@/lib/types';


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

  /*
   * The DEPOT's clock, not the viewer's — and since W11 that difference spends money.
   *
   * order-service decides this with `isOpenAt(..., config.businessTimeZone)`; this copy read
   * `now.getHours()`, the device's own clock. While the answer only chose a badge word the
   * two could disagree harmlessly. Now it also disables the pay button, so a phone set to
   * WITA/WIT — or one with a wrong clock, or a browser in another country — refuses an order
   * the server would have accepted, and says the depot is shut when it is open.
   *
   * Caught by CI: the runner's clock is UTC, the seeded depot opens 08:00-20:00 WIB, and at
   * 20:41 UTC the checkout E2E could not submit. Same wall clock, two answers.
   *
   * BUSINESS_TZ is the constant `format.ts`, `hr.ts` and `wib.ts` already read; it stopped one
   * file short of the one that gates checkout.
   */
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const at = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';

  const day = `${at('year')}-${at('month')}-${at('day')}`;
  if (holidays?.some((h) => h?.date === day)) return 'tutup';

  // `weekday: 'short'` in en-GB gives Mon/Tue/...; the hours map is keyed the same way, so
  // the day is matched by NAME rather than by an index that would assume a locale week start.
  const today = hours[at('weekday').toLowerCase().slice(0, 3)];
  if (!today) return 'tutup';

  const open = minutesOf(today.open);
  const close = minutesOf(today.close);
  if (open === null || close === null || close <= open) return 'buka';

  // `hour12: false` can render midnight as 24 in some engines; normalised so 24:10 is 00:10.
  const nowMinutes = (Number(at('hour')) % 24) * 60 + Number(at('minute'));
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
