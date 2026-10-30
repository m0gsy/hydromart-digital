export type PayoutSubjectType = 'OWNER' | 'COURIER';
export type BankAccountStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface PayoutBankAccountRecord {
  id: string;
  subjectId: string;
  subjectType: PayoutSubjectType;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  status: BankAccountStatus;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  rejectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterBankAccountData {
  subjectId: string;
  subjectType: PayoutSubjectType;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

/** PYO-3: one payout destination per person, verified by HQ before it is used. */
export interface PayoutBankAccountRepository {
  /** Register or replace this person's account. A replacement goes back to PENDING. */
  upsert(data: RegisterBankAccountData): Promise<PayoutBankAccountRecord>;
  findBySubject(subjectId: string): Promise<PayoutBankAccountRecord | null>;
  findById(id: string): Promise<PayoutBankAccountRecord | null>;
  listByStatus(status: BankAccountStatus, limit: number): Promise<PayoutBankAccountRecord[]>;
  /**
   * PENDING → VERIFIED/REJECTED, only while still pending; null when already decided.
   *
   * `seenUpdatedAt` pins the decision to the row the reviewer actually looked at. A
   * re-registration reuses the same row id and resets it to PENDING with a NEW destination,
   * so "still PENDING" alone cannot tell the account that was reviewed from the one that
   * replaced it a moment later.
   */
  decide(
    id: string,
    data: { status: 'VERIFIED' | 'REJECTED'; verifiedBy: string; rejectedReason: string | null },
    seenUpdatedAt?: Date,
  ): Promise<PayoutBankAccountRecord | null>;
}
