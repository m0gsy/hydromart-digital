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
  searchForDepot(
    depotId: string | null,
    status: ExpenseClaimStatus | null,
    page: number,
    limit: number,
  ): Promise<{ items: ExpenseClaimRecord[]; total: number }>;
}
