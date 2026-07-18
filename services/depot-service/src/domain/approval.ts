// Depot-manager approval queue (design cells 1c/2a-2c/10c/12a). A depot-scoped inbox of
// value decisions a manager must sign off — stock-count losses, deposit refunds, COD
// shortfalls. Mirrors the Prisma enums; the domain never imports the generated client.

export enum ApprovalType {
  OPNAME_VARIANCE = 'OPNAME_VARIANCE',
  DEPOSIT_REFUND = 'DEPOSIT_REFUND',
  COD_VARIANCE = 'COD_VARIANCE',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  HELD = 'HELD',
}

/** JSON snapshot rendered on the detail screen (shape varies by type). */
export type ApprovalPayload = Record<string, unknown>;

/** A depot-scoped value decision awaiting (or past) a manager's sign-off. */
export interface Approval {
  id: string;
  depotId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  title: string;
  /** Account id of the operator/system that raised the item. */
  submittedBy: string;
  /** Human subject of the decision (product / customer / courier name). */
  subjectRef: string | null;
  /** Signed rupiah at stake: loss (opname), refund (deposit), shortfall (COD). */
  amountIdr: number;
  /** Snapshot for the detail view: {system,physical,variance} | {condition,deposit} | {expected,received}. */
  payload: ApprovalPayload;
  /** At/under |amount| this item auto-passed without review. */
  autoPassThreshold: number;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/**
 * True when the value is large enough to need a human decision. Auto-passes (no review)
 * when the absolute amount is at or under the threshold — mirrors payout's isAutoApproved.
 */
export function needsApproval(amountIdr: number, threshold: number): boolean {
  return Math.abs(amountIdr) > threshold;
}
