import { LedgerEntryRecord, LedgerEntryType } from '../../domain/ledger';

export interface CreateLedgerEntryData {
  franchiseOwnerId: string;
  depotId: string | null;
  type: LedgerEntryType;
  amount: number;
  description: string;
  occurredAt?: Date;
}

export interface LedgerRepository {
  create(data: CreateLedgerEntryData): Promise<LedgerEntryRecord>;
  /** Signed sum of every entry for one owner (the available balance). */
  balanceFor(franchiseOwnerId: string): Promise<number>;
  /** Sum of entries of one type over an inclusive date range. */
  sumByType(franchiseOwnerId: string, type: LedgerEntryType, since: Date): Promise<number>;
  listForOwner(
    franchiseOwnerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: LedgerEntryRecord[]; total: number }>;
}
