// Voucher-request domain (design 14b HQ voucher governance). A depot manager
// requests HQ to create a promo voucher for their area; HQ approves (which creates
// the real voucher through the existing VoucherService.create) or rejects. This model
// only carries the request itself. Mirrors the Prisma enum; the domain never imports
// the generated client.

import { DiscountType } from './voucher';

export enum VoucherRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface VoucherRequestRecord {
  id: string;
  depotId: string;
  /** Denormalized depot name (captured at request time) for the HQ queue display. */
  depotName: string;
  /** Proposed voucher code (uppercased when the voucher is finally created). */
  code: string;
  description: string | null;
  discountType: DiscountType;
  /** PERCENTAGE: percent 1..100. FIXED: rupiah off. */
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  note: string | null;
  status: VoucherRequestStatus;
  requestedBy: string;
  decidedBy: string | null;
  /** The voucher created on approval, or null while pending/rejected. */
  createdVoucherId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** APPROVED/REJECTED are terminal — no further decisions. */
export function isTerminalStatus(status: VoucherRequestStatus): boolean {
  return status === VoucherRequestStatus.APPROVED || status === VoucherRequestStatus.REJECTED;
}
