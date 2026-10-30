import {
  AnonymisedIdentity,
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../../domain/data-subject/data-subject-request';

export interface CreateDataSubjectRequestData {
  customerId: string;
  type: DataSubjectRequestType;
  reason: string | null;
}

export interface DecideDataSubjectRequestData {
  id: string;
  status: Exclude<DataSubjectRequestStatus, 'PENDING' | 'IN_PROGRESS'>;
  processedBy: string;
  reason: string | null;
  /** The status this decision may follow. Default PENDING (a rejection); approvals pass IN_PROGRESS. */
  from?: 'PENDING' | 'IN_PROGRESS';
}

export interface DataSubjectRequestRepository {
  create(data: CreateDataSubjectRequestData): Promise<DataSubjectRequestRecord>;
  findById(id: string): Promise<DataSubjectRequestRecord | null>;
  /** The customer's own requests, newest first. */
  listByCustomer(customerId: string): Promise<DataSubjectRequestRecord[]>;
  /** An open request of this type, if any — one queue entry per right at a time. */
  findOpen(
    customerId: string,
    type: DataSubjectRequestType,
  ): Promise<DataSubjectRequestRecord | null>;
  /** The staff queue: PENDING first (oldest first), then recently decided rows. */
  listForStaff(status?: DataSubjectRequestStatus): Promise<DataSubjectRequestRecord[]>;
  /**
   * Takes the request for an approval: PENDING -> IN_PROGRESS, or an IN_PROGRESS whose claim is
   * older than `staleAfterMs` (a crashed run, resumed). False = someone else holds it or it is
   * already decided, and no side effect may run.
   */
  claim(id: string, staffId: string, now: Date, staleAfterMs: number): Promise<boolean>;
  /**
   * Gives a claim back (IN_PROGRESS -> PENDING) after a run that threw, so the approval can be
   * retried straight away. Only the claimant's own claim is released.
   */
  release(id: string, staffId: string): Promise<void>;
  /**
   * Records the decision. Guarded on status PENDING in the WHERE clause so two
   * concurrent approvals cannot run the deletion twice.
   */
  decide(data: DecideDataSubjectRequestData): Promise<DataSubjectRequestRecord>;
  /**
   * Destroys the account's identifiers and revokes its sessions in one transaction.
   * Status becomes DELETED; the row itself stays so the money records still have a
   * foreign key to point at (item 12, FINANCIAL retention).
   */
  anonymiseCustomer(customerId: string, identity: AnonymisedIdentity): Promise<void>;
}
