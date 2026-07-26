/**
 * CRM lifecycle segmentation (Fase 4). Pure functions over a customer's order
 * aggregate — no I/O — so they are trivially unit-testable and shared by the depot
 * directory (per-row segment) and the CRM dashboard (segment counts + follow-up queue).
 */

export type CrmSegment = 'BARU' | 'AKTIF' | 'INACTIVE';

export interface CrmThresholds {
  /** First order within this many days → still "Baru" (newly acquired). */
  newDays: number;
  /** Last order within this many days → "Aktif". Older → "Inactive". */
  activeDays: number;
  /** Inactive AND last order at least this old → surfaces in the follow-up queue. */
  followUpDays: number;
}

export interface CrmAggregate {
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

const DAY_MS = 86_400_000;

/** Whole days elapsed from `from` to `to` (floored). Negative if `from` is in the future. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Baru: first order within newDays (acquisition window wins over Aktif).
 * Aktif: ordered within activeDays. Otherwise Inactive (incl. never-ordered).
 */
export function classifySegment(agg: CrmAggregate, now: Date, t: CrmThresholds): CrmSegment {
  if (agg.orderCount === 0 || !agg.lastOrderAt) return 'INACTIVE';
  if (agg.firstOrderAt && daysBetween(agg.firstOrderAt, now) <= t.newDays) return 'BARU';
  if (daysBetween(agg.lastOrderAt, now) <= t.activeDays) return 'AKTIF';
  return 'INACTIVE';
}

/** True when the customer is due a follow-up: has ordered, but not within followUpDays. */
export function needsFollowUp(agg: CrmAggregate, now: Date, t: CrmThresholds): boolean {
  return !!agg.lastOrderAt && daysBetween(agg.lastOrderAt, now) >= t.followUpDays;
}
