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
  update(id: string, data: UpdateApprovalData): Promise<Approval>;
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
