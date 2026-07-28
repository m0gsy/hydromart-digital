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
  status: Exclude<DataSubjectRequestStatus, 'PENDING'>;
  processedBy: string;
  reason: string | null;
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
