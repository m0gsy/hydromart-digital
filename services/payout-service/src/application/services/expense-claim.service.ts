import { Inject, Injectable } from '@nestjs/common';

import {
  ExpenseClaimNotFoundError,
  ExpenseClaimNotPendingError,
  InvalidExpenseAmountError,
} from '../../domain/errors';
import { ExpenseCategory, ExpenseClaimStatus, isAutoApproved } from '../../domain/expense-claim';
import { PayoutConfigService } from '../../config/payout-config.service';
import { CourierLedgerRepository } from '../ports/courier-ledger.repository';
import {
  ExpenseClaimRecord,
  ExpenseClaimRepository,
} from '../ports/expense-claim.repository';
import { PAYOUT_TOKENS } from '../tokens';
import { Page, buildPage } from '../pagination';

export interface SubmitExpenseInput {
  category: ExpenseCategory;
  amount: number;
  description: string;
  depotId?: string | null;
  receiptUrl?: string | null;
}

@Injectable()
export class ExpenseClaimService {
  constructor(
    @Inject(PAYOUT_TOKENS.ExpenseClaimRepository)
    private readonly claims: ExpenseClaimRepository,
    @Inject(PAYOUT_TOKENS.CourierLedgerRepository)
    private readonly ledger: CourierLedgerRepository,
    private readonly config: PayoutConfigService,
  ) {}

  /**
   * Courier files an expense claim. Auto-approved (and immediately credited) when the
   * amount is at or under the depot's threshold; otherwise it waits for a reviewer.
   */
  async submit(courierId: string, input: SubmitExpenseInput): Promise<ExpenseClaimRecord> {
    if (!(input.amount > 0)) throw new InvalidExpenseAmountError();
    const depotId = input.depotId ?? null;
    const auto = isAutoApproved(input.amount, this.config.expenseAutoApproveMaxIdr);

    const claim = await this.claims.create({
      courierId,
      depotId,
      category: input.category,
      amount: input.amount,
      description: input.description,
      receiptUrl: input.receiptUrl ?? null,
      status: 'PENDING',
    });
    if (!auto) return claim;

    const entry = await this.creditLedger(claim);
    return this.claims.markReviewed(claim.id, {
      status: 'APPROVED',
      reviewedBy: null,
      reviewNote: 'Disetujui otomatis (di bawah ambang)',
      ledgerEntryId: entry.id,
    });
  }

  /** Reviewer approves a pending claim: credit the courier ledger, then mark it approved. */
  async approve(id: string, reviewerId: string, note?: string): Promise<ExpenseClaimRecord> {
    const claim = await this.loadPending(id);
    const entry = await this.creditLedger(claim);
    return this.claims.markReviewed(id, {
      status: 'APPROVED',
      reviewedBy: reviewerId,
      reviewNote: note ?? null,
      ledgerEntryId: entry.id,
    });
  }

  /** Reviewer rejects a pending claim: no ledger movement. */
  async reject(id: string, reviewerId: string, note?: string): Promise<ExpenseClaimRecord> {
    await this.loadPending(id);
    return this.claims.markReviewed(id, {
      status: 'REJECTED',
      reviewedBy: reviewerId,
      reviewNote: note ?? null,
    });
  }

  listForCourier(courierId: string, page: number, limit: number): Promise<Page<ExpenseClaimRecord>> {
    return this.claims
      .listForCourier(courierId, page, limit)
      .then(({ items, total }) => buildPage(items, total, page, limit));
  }

  searchForDepot(
    depotId: string | null,
    status: ExpenseClaimStatus | null,
    page: number,
    limit: number,
  ): Promise<Page<ExpenseClaimRecord>> {
    return this.claims
      .searchForDepot(depotId, status, page, limit)
      .then(({ items, total }) => buildPage(items, total, page, limit));
  }

  private async loadPending(id: string): Promise<ExpenseClaimRecord> {
    const claim = await this.claims.findById(id);
    if (!claim) throw new ExpenseClaimNotFoundError();
    if (claim.status !== 'PENDING') throw new ExpenseClaimNotPendingError();
    return claim;
  }

  /** Idempotent credit: sourceRef "expense:<id>" means a retried approval posts nothing new. */
  private async creditLedger(claim: ExpenseClaimRecord) {
    const sourceRef = `expense:${claim.id}`;
    const existing = await this.ledger.findBySourceRef(sourceRef);
    if (existing) return existing;
    return this.ledger.create({
      courierId: claim.courierId,
      depotId: claim.depotId,
      type: 'ADJUSTMENT',
      amount: claim.amount,
      description: `Klaim pengeluaran disetujui`,
      sourceRef,
    });
  }
}
