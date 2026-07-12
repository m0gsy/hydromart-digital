// Promotion domain rules. A promotion is a Home-page marketing banner. It is
// "live" when active and the current time falls inside its optional date window.

/** The subset of a promotion the pure live-window rule needs. */
export interface PromotionWindow {
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * True when the promotion should be shown to customers at `now`: it is active
 * AND has started (startsAt null or in the past) AND has not ended (endsAt null
 * or in the future). Pure — the caller supplies `now`.
 */
export function isPromotionLiveAt(p: PromotionWindow, now: Date): boolean {
  if (!p.active) return false;
  if (p.startsAt !== null && p.startsAt > now) return false;
  if (p.endsAt !== null && p.endsAt < now) return false;
  return true;
}
