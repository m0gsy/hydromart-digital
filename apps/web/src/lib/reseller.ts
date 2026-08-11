// Reseller ("agen") registry types + pure achievement-evaluation helper. Mirrors the
// customer-service ResellerProfile and the order-service reseller-rollup response; the
// server stays authority for the raw figures, this file only derives display metrics.

export interface Reseller {
  customerId: string;
  /** Account name behind `customerId` (§G-3). Null when the account has none. */
  customerName: string | null;
  homeDepotId: string;
  monthlyTargetQty: number;
  discountPct: number;
  /** SOP: flat rupiah per galon; > 0 replaces `discountPct` at checkout. 0 = price by percent. */
  flatGallonPriceIdr: number;
  /** Registration photo of the agen, or null when none was uploaded. */
  photoUrl: string | null;
  active: boolean;
  joinDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResellerRollupRow {
  customerId: string;
  volumeQty: number;
  prevVolumeQty: number;
  orderCount: number;
  lastOrderAt: string | null;
}

export type ResellerStatus = 'no-target' | 'di-bawah' | 'tercapai' | 'lampaui';

export interface ResellerMetrics {
  /** volume / target * 100, rounded. null when no target is set (never divides). */
  attainmentPct: number | null;
  status: ResellerStatus;
  /** (volume - prev) / prev * 100, rounded. From-zero growth: +100 if volume>0 else 0. */
  growthPct: number;
  /** No order at all, or last order older than inactiveDays. */
  pasif: boolean;
}

export const RESELLER_STATUS_LABEL: Record<ResellerStatus, string> = {
  'no-target': 'Tanpa target',
  'di-bawah': 'Di bawah',
  tercapai: 'Tercapai',
  lampaui: 'Lampaui',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateReseller(input: {
  volumeQty: number;
  prevVolumeQty: number;
  monthlyTargetQty: number;
  lastOrderAt: string | null;
  asOf?: Date;
  inactiveDays?: number;
}): ResellerMetrics {
  const { volumeQty, prevVolumeQty, monthlyTargetQty, lastOrderAt } = input;
  const asOf = input.asOf ?? new Date();
  const inactiveDays = input.inactiveDays ?? 30;

  const attainmentPct =
    monthlyTargetQty <= 0 ? null : Math.round((volumeQty / monthlyTargetQty) * 100);

  let status: ResellerStatus;
  if (attainmentPct === null) status = 'no-target';
  else if (attainmentPct >= 120) status = 'lampaui';
  else if (attainmentPct >= 100) status = 'tercapai';
  else status = 'di-bawah';

  const growthPct =
    prevVolumeQty <= 0
      ? volumeQty > 0
        ? 100
        : 0
      : Math.round(((volumeQty - prevVolumeQty) / prevVolumeQty) * 100);

  const pasif =
    lastOrderAt == null || (asOf.getTime() - new Date(lastOrderAt).getTime()) / DAY_MS > inactiveDays;

  return { attainmentPct, status, growthPct, pasif };
}
