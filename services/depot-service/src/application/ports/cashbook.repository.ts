import { CashbookEntry, CashDirection } from '../../domain/cashbook';

export interface CreateCashbookEntryData {
  depotId: string;
  direction: CashDirection;
  category: string;
  label: string;
  amountIdr: number;
  occurredAt: Date;
  sourceRef: string | null;
  /** CA-2-22: the entry this one cancels; null on an ordinary posting. */
  reversesId?: string | null;
  /** Why it was reversed. Set whenever `reversesId` is. */
  reversalReason?: string | null;
  actorId: string;
}

/** Optional occurredAt window; both bounds inclusive. */
export interface CashbookDateRange {
  from?: Date;
  to?: Date;
}

export interface CashbookRepository {
  create(data: CreateCashbookEntryData): Promise<CashbookEntry>;
  /** A depot's entries, newest first, optionally bounded by occurredAt. */
  listForDepot(depotId: string, range: CashbookDateRange): Promise<CashbookEntry[]>;
  /** CA-2-22: one entry, to reverse it. Null when the id is unknown. */
  findById(id: string): Promise<CashbookEntry | null>;
  /** CA-2-22: the reversal of `id`, when one exists — one entry reverses at most once. */
  findReversalOf(id: string): Promise<CashbookEntry | null>;
}
