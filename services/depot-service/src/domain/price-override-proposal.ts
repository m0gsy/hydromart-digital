// Price-override-proposal domain (design 7a HQ price governance). A depot manager
// proposes a per-product price adjustment; HQ approves (priority-wins) or rejects.
// On approval the actual pricing rule is created through the existing pricing
// mechanism (PricingService.create) — this model only carries the proposal itself.
// Mirrors the Prisma enum; the domain never imports the generated client.

import { PricingAdjustType } from './pricing-rule';

export enum PriceOverrideStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface PriceOverrideProposalRecord {
  id: string;
  depotId: string;
  /** Denormalized depot name (resolved at propose time) for the HQ queue display. */
  depotName: string;
  productId: string;
  /** Denormalized product name captured by the proposer for the HQ queue display. */
  productName: string;
  /** Snapshot of the depot's current price for this product at propose time (IDR). */
  currentPrice: number;
  adjustType: PricingAdjustType;
  /** PERCENT = signed percent (-10 = 10% off); FIXED = signed rupiah delta. */
  value: number;
  note: string | null;
  status: PriceOverrideStatus;
  proposedBy: string;
  decidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** APPROVED/REJECTED are terminal — no further decisions. */
export function isTerminalStatus(status: PriceOverrideStatus): boolean {
  return status === PriceOverrideStatus.APPROVED || status === PriceOverrideStatus.REJECTED;
}

/**
 * Rupiah the override moves the price by, regardless of direction — the figure the
 * four-eyes threshold is measured against. PERCENT is signed percent of the snapshot
 * price; FIXED is a signed rupiah delta.
 */
export function overrideImpactIdr(
  currentPrice: number,
  adjustType: PricingAdjustType,
  value: number,
): number {
  const raw = adjustType === PricingAdjustType.PERCENT ? (currentPrice * value) / 100 : value;
  return Math.abs(Math.round(raw));
}

/**
 * M18-15: four-eyes rule. Whoever proposed an override may not also decide it once the
 * money at stake clears the depot's auto-pass threshold — that decision belongs to HQ.
 * A non-positive threshold means every self-approval needs a second pair of eyes.
 */
export function needsSecondApprover(
  proposedBy: string,
  decidedBy: string,
  impactIdr: number,
  autoPassIdr: number,
): boolean {
  return proposedBy === decidedBy && !(autoPassIdr > 0 && impactIdr <= autoPassIdr);
}
