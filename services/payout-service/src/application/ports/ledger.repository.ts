import { LedgerEntryRecord, LedgerEntryType } from '../../domain/ledger';

export interface CreateLedgerEntryData {
  franchiseOwnerId: string;
  depotId: string | null;
  type: LedgerEntryType;
  amount: number;
  description: string;
  occurredAt?: Date;
}

/** One owner's network-wide available balance (signed sum of all their entries). */
export interface OwnerBalance {
  franchiseOwnerId: string;
  availableBalance: number;
}

export interface LedgerRepository {
  create(data: CreateLedgerEntryData): Promise<LedgerEntryRecord>;
  /** Signed sum of every entry for one owner (the available balance). */
  balanceFor(franchiseOwnerId: string): Promise<number>;
  /** Every owner with a positive balance (the HQ payout-release queue), highest first. */
  ownersWithBalance(): Promise<OwnerBalance[]>;
  /** Sum of entries of one type over an inclusive date range. */
  sumByType(franchiseOwnerId: string, type: LedgerEntryType, since: Date): Promise<number>;
  listForOwner(
    franchiseOwnerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: LedgerEntryRecord[]; total: number }>;
}
