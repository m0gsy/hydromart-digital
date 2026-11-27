import { localMinutesOfDay } from '@hydromart/platform';

/** The two states depot-service's `depot.quality_hold_changed` event carries (domain/quality-hold.ts there). */
export const QUALITY_HOLD_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type QualityHoldStatus = (typeof QUALITY_HOLD_STATUSES)[number];

/** Marketing is told besides the depot's own management: a hold stops campaigns and promos network-wide copy. */
export const QUALITY_HOLD_MARKETING_ROLE = 'MARKETING';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Staff copy, WIB clock. No reason and no lab detail: those never leave depot-service. */
export function qualityHoldText(status: QualityHoldStatus, depot: string, changedAt: Date): string {
  const minutes = localMinutesOfDay(changedAt);
  const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  return status === 'ACTIVE'
    ? `Depot ${depot} sedang quality hold sejak ${time} WIB. Pesanan online, pengingat, kampanye, dan penjualan kasir depot ini berhenti sampai HQ Operasional mengakhirinya.`
    : `Quality hold depot ${depot} sudah selesai (${time} WIB). Depot melayani lagi.`;
}
