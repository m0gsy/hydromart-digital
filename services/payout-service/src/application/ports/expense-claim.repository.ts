import { ExpenseCategory, ExpenseClaimStatus } from '../../domain/expense-claim';

export interface ExpenseClaimRecord {
  id: string;
  courierId: string;
  depotId: string | null;
  category: ExpenseCategory;
  amount: number;
  description: string;
  receiptUrl: string | null;
  status: ExpenseClaimStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  ledgerEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseClaimData {
  courierId: string;
  depotId: string | null;
  category: ExpenseCategory;
  amount: number;
  description: string;
  receiptUrl?: string | null;
  status: ExpenseClaimStatus;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  ledgerEntryId?: string | null;
}

export interface ReviewExpenseClaimData {
  status: ExpenseClaimStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  ledgerEntryId?: string | null;
}

export interface ExpenseClaimRepository {
  create(data: CreateExpenseClaimData): Promise<ExpenseClaimRecord>;
  findById(id: string): Promise<ExpenseClaimRecord | null>;
  /**
   * PYO-4: moves a claim out of PENDING only if it is STILL pending — null when another
   * reviewer got there first. The guard lives in the WHERE clause, not in a read before it.
   */
  markReviewed(id: string, data: ReviewExpenseClaimData): Promise<ExpenseClaimRecord | null>;
  /** Records the ledger credit on an approved claim. */
  attachLedgerEntry(id: string, ledgerEntryId: string): Promise<ExpenseClaimRecord>;
  /** Puts an approval whose credit failed back to PENDING, so it can be decided again. */
  reopen(id: string): Promise<void>;
  /** PYO-1: how many claims already carry this receipt. */
  countByReceiptUrl(receiptUrl: string): Promise<number>;
  listForCourier(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ExpenseClaimRecord[]; total: number }>;
  /**
   * The approval queue. `depotIds` null = every depot (finance/HQ); a list = exactly those
   * depots, which is how a depot-scoped reviewer is held to their own (AUTHZ-A5).
   */
  searchForDepot(
    depotIds: readonly string[] | null,
    status: ExpenseClaimStatus | null,
    page: number,
    limit: number,
  ): Promise<{ items: ExpenseClaimRecord[]; total: number }>;
  /**
   * CA-2-59: APPROVED claims per depot over a window, by the date they were approved.
   *
   * By `reviewedAt`, not `createdAt`: a claim filed in June and approved in July is July's
   * cost — the same rule the PO goods cost uses with `receivedAt`. Only APPROVED counts;
   * a pending claim is a request, and a rejected one never became money.
   */
  approvedTotalByDepot(
    depotIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>>;
}
