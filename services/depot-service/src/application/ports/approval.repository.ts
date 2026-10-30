import { Approval, ApprovalPayload, ApprovalStatus, ApprovalType } from '../../domain/approval';

export interface CreateApprovalData {
  depotId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  title: string;
  submittedBy: string;
  subjectRef: string | null;
  amountIdr: number;
  payload: ApprovalPayload;
  autoPassThreshold: number;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

/** Decision patch written by decide(). */
export interface UpdateApprovalData {
  status: ApprovalStatus;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

/** Pending count per type for the queue badge. */
export type PendingCounts = Record<ApprovalType, number>;

export interface ApprovalRepository {
  create(data: CreateApprovalData): Promise<Approval>;
  /** A depot's items, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: ApprovalStatus): Promise<Approval[]>;
  findById(id: string): Promise<Approval | null>;
  /**
   * Records a decision — but only while the item is still open (PENDING or HELD); null when
   * somebody else decided it first.
   *
   * The service's own "already decided" check is a read, so two managers could both pass it
   * and both write: an approval and a rejection of the same item, the later one silently
   * winning, with both decisions in the audit trail.
   */
  decideIfOpen(id: string, data: UpdateApprovalData): Promise<Approval | null>;
  /** PENDING counts grouped by type for one depot. */
  pendingCounts(depotId: string): Promise<PendingCounts>;
  /**
   * How many of a depot's approvals a PERSON decided in [from, to).
   *
   * `decidedBy != null` is the whole point: an amount under the depot's threshold is stored
   * APPROVED with a `decidedAt` and no decider, so counting timestamps alone would report a
   * month of automatic passes as a month of review.
   */
  countReviewedInRange(depotId: string, from: Date, to: Date): Promise<number>;
}
