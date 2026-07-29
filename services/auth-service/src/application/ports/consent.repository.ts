import { ConsentPurpose, ConsentRecord } from '../../domain/data-subject/consent';

export interface RecordConsentData {
  customerId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  documentVersion: string;
  source: string;
}

export interface ConsentRepository {
  /** Append one decision. Never updates a prior row — the history IS the evidence. */
  record(data: RecordConsentData): Promise<ConsentRecord>;
  /** Append several in one transaction (registration grants TERMS + PRIVACY together). */
  recordMany(entries: RecordConsentData[]): Promise<ConsentRecord[]>;
  /** Every decision this customer has made, oldest first. */
  listForCustomer(customerId: string): Promise<ConsentRecord[]>;
}
