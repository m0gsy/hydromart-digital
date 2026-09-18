export type ReleaseRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ReleaseRequestRecord {
  id: string;
  franchiseOwnerId: string;
  bankAccountRef: string | null;
  amountAtRequest: number;
  requestedBy: string;
  status: ReleaseRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string | null;
  withdrawalId: string | null;
  createdAt: Date;
}

export interface CreateReleaseRequestData {
  franchiseOwnerId: string;
  bankAccountRef: string | null;
  amountAtRequest: number;
  requestedBy: string;
}

/** PYO-2: HQ release requests awaiting a second person. */
export interface ReleaseRequestRepository {
  /** Null when this owner already has a PENDING request (unique partial index). */
  create(data: CreateReleaseRequestData): Promise<ReleaseRequestRecord | null>;
  findById(id: string): Promise<ReleaseRequestRecord | null>;
  listByStatus(status: ReleaseRequestStatus, limit: number): Promise<ReleaseRequestRecord[]>;
  /** PENDING → `status`, only if still PENDING; null when somebody decided it first. */
  decide(
    id: string,
    data: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null },
  ): Promise<ReleaseRequestRecord | null>;
  attachWithdrawal(id: string, withdrawalId: string): Promise<ReleaseRequestRecord>;
  /** Undo an approval whose release failed, so it can be decided again. */
  reopen(id: string): Promise<void>;
}
