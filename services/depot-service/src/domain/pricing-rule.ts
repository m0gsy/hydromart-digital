export enum PricingAdjustType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export interface PricingRuleRecord {
  id: string;
  depotId: string;
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  /** 0=Sun..6=Sat; empty = every day. */
  daysOfWeek: number[];
  /** Minutes since local midnight; null = all day. endMinute is exclusive. */
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Weekday (0=Sun..6=Sat) and minute-of-day for `now` in the given IANA timezone. */
export function localParts(now: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  return { weekday, minute };
}

/** True when `rule` is enabled and `now` falls inside its day / time-of-day / date window. */
export function isRuleActive(rule: PricingRuleRecord, now: Date, timeZone: string): boolean {
  if (!rule.active) return false;
  if (rule.validFrom && now < rule.validFrom) return false;
  if (rule.validUntil && now > rule.validUntil) return false;

  const { weekday, minute } = localParts(now, timeZone);
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(weekday)) return false;
  if (rule.startMinute !== null && minute < rule.startMinute) return false;
  if (rule.endMinute !== null && minute >= rule.endMinute) return false;
  return true;
}

/**
 * The single winning rule for a product at `now`, or null. Considers active,
 * in-window rules that target this product OR the whole depot (productId=null).
 * Precedence: product-specific beats depot-wide, then higher priority, then newest.
 */
export function resolveRule(
  rules: PricingRuleRecord[],
  productId: string,
  now: Date,
  timeZone: string,
): PricingRuleRecord | null {
  const candidates = rules.filter(
    (r) =>
      (r.productId === productId || r.productId === null) && isRuleActive(r, now, timeZone),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aSpecific = a.productId === null ? 0 : 1;
    const bSpecific = b.productId === null ? 0 : 1;
    if (aSpecific !== bSpecific) return bSpecific - aSpecific;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return candidates[0];
}
