import { CashbookEntry, CashDirection } from '../../domain/cashbook';

export interface CreateCashbookEntryData {
  depotId: string;
  direction: CashDirection;
  category: string;
  label: string;
  amountIdr: number;
  occurredAt: Date;
  sourceRef: string | null;
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
}
