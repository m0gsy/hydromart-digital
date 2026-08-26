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
  markReviewed(id: string, data: ReviewExpenseClaimData): Promise<ExpenseClaimRecord>;
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
}
