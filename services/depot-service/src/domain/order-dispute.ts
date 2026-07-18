// Customer order disputes raised at a depot (wrong item, not received, overcharge,
// quality). Mirrors the Prisma enums; the domain never imports the generated client.

export enum DisputeCategory {
  WRONG_ITEM = 'WRONG_ITEM',
  NOT_RECEIVED = 'NOT_RECEIVED',
  OVERCHARGED = 'OVERCHARGED',
  QUALITY = 'QUALITY',
  OTHER = 'OTHER',
}

export enum DisputeStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

export enum DisputeResolution {
  REFUND = 'REFUND',
  RESEND = 'RESEND',
  REJECTED = 'REJECTED',
}

/** A depot-scoped customer complaint about an order, with an OPEN → RESOLVED/REJECTED lifecycle. */
export interface OrderDispute {
  id: string;
  depotId: string;
  orderRef: string;
  customerName: string;
  category: DisputeCategory;
  description: string;
  amountIdr: number;
  courierName: string | null;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  resolutionNote: string | null;
  raisedBy: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
