import { LedgerEntryRecord, LedgerEntryType } from '../../domain/ledger';

export interface CreateLedgerEntryData {
  franchiseOwnerId: string;
  depotId: string | null;
  type: LedgerEntryType;
  amount: number;
  description: string;
  /** Idempotency key for pushed entries ("order:<id>:SALE"); null for manual ones. */
  sourceRef?: string | null;
  occurredAt?: Date;
}

/** One owner's network-wide available balance (signed sum of all their entries). */
export interface OwnerBalance {
  franchiseOwnerId: string;
  availableBalance: number;
}

export interface LedgerRepository {
  create(data: CreateLedgerEntryData): Promise<LedgerEntryRecord>;
  /**
   * Writes several entries as one unit (H-7).
   *
   * A sale and the commission it owes are one economic event: written separately, a crash
   * between them leaves the owner credited for a sale nobody took commission on, and the
   * gap only shows up when somebody reconciles a month of ledger by hand. The reversal
   * pair has the same property in the opposite direction.
   *
   * Idempotency still rides on the unique `sourceRef`, so a retried push that lost the
   * race raises rather than double-crediting.
   */
  createAll(entries: CreateLedgerEntryData[]): Promise<void>;
  /** The entry already posted under this source reference, if any (push idempotency). */
  findBySourceRef(sourceRef: string): Promise<LedgerEntryRecord | null>;
  /** Signed sum of every entry for one owner (the available balance). */
  balanceFor(franchiseOwnerId: string): Promise<number>;
  /** Every owner with a positive balance (the HQ payout-release queue), highest first. */
  ownersWithBalance(): Promise<OwnerBalance[]>;
  /** Sum of entries of one type over an inclusive date range. */
  sumByType(franchiseOwnerId: string, type: LedgerEntryType, since: Date): Promise<number>;
  /**
   * One owner's ledger page. `cursor` is the previous page's `nextCursor`: the ledger is
   * append-only and never stops growing, so paging deep into it by OFFSET walks every
   * earlier row (audit Q-16). `page` is ignored when a cursor is given.
   */
  listForOwner(
    franchiseOwnerId: string,
    page: number,
    limit: number,
    cursor?: string,
  ): Promise<{ items: LedgerEntryRecord[]; total: number; nextCursor: string | null }>;
}
