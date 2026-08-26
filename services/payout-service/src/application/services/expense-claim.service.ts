import { Inject, Injectable } from '@nestjs/common';
import {  AuthenticatedUser,  assertDepotAccess,  depotScopeIds,} from '@hydromart/platform';

import {
  ExpenseClaimNotFoundError,
  ExpenseClaimNotPendingError,
  InvalidExpenseAmountError,
} from '../../domain/errors';
import { ExpenseCategory, ExpenseClaimStatus, isAutoApproved } from '../../domain/expense-claim';
import { PayoutConfigService } from '../../config/payout-config.service';
import { CourierLedgerRepository } from '../ports/courier-ledger.repository';
import { ExpenseClaimRecord, ExpenseClaimRepository } from '../ports/expense-claim.repository';
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
   * amount is at or under the depot's threshold AND a receipt is attached; otherwise it
   * waits for a reviewer (M20-15).
   */
  async submit(courierId: string, input: SubmitExpenseInput): Promise<ExpenseClaimRecord> {
    if (!(input.amount > 0)) throw new InvalidExpenseAmountError();
    const depotId = input.depotId ?? null;
    const receiptUrl = input.receiptUrl?.trim() || null;
    const auto = isAutoApproved(
      input.amount,
      this.config.expenseAutoApproveMaxIdr(depotId),
      receiptUrl !== null,
    );

    const claim = await this.claims.create({
      courierId,
      depotId,
      category: input.category,
      amount: input.amount,
      description: input.description,
      receiptUrl,
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
  async approve(
    id: string,
    reviewerId: string,
    note?: string,
    reviewer?: AuthenticatedUser,
  ): Promise<ExpenseClaimRecord> {
    const claim = await this.loadPending(id, reviewer);
    const entry = await this.creditLedger(claim);
    return this.claims.markReviewed(id, {
      status: 'APPROVED',
      reviewedBy: reviewerId,
      reviewNote: note ?? null,
      ledgerEntryId: entry.id,
    });
  }

  /** Reviewer rejects a pending claim: no ledger movement. */
  async reject(
    id: string,
    reviewerId: string,
    note?: string,
    reviewer?: AuthenticatedUser,
  ): Promise<ExpenseClaimRecord> {
    await this.loadPending(id, reviewer);
    return this.claims.markReviewed(id, {
      status: 'REJECTED',
      reviewedBy: reviewerId,
      reviewNote: note ?? null,
    });
  }

  listForCourier(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<Page<ExpenseClaimRecord>> {
    return this.claims
      .listForCourier(courierId, page, limit)
      .then(({ items, total }) => buildPage(items, total, page, limit));
  }

  /**
   * The approval queue. `reviewer` narrows it: asked for "all depots", a depot-scoped
   * reviewer gets their own rather than the network's — the unfiltered queue is where the
   * ids of other depots' claims came from in the first place (AUTHZ-A5). A named depot that
   * is not theirs is refused outright, as everywhere else.
   */
  async searchForDepot(
    depotId: string | null,
    status: ExpenseClaimStatus | null,
    page: number,
    limit: number,
    reviewer?: AuthenticatedUser,
  ): Promise<Page<ExpenseClaimRecord>> {
    if (depotId) {
      assertDepotAccess(reviewer, depotId);
    }
    const scope = depotId ? [depotId] : (depotScopeIds(reviewer) ?? null);
    return this.claims
      .searchForDepot(scope, status, page, limit)
      .then(({ items, total }) => buildPage(items, total, page, limit));
  }

  private async loadPending(
    id: string,
    reviewer?: AuthenticatedUser,
  ): Promise<ExpenseClaimRecord> {
    const claim = await this.claims.findById(id);
    if (!claim) throw new ExpenseClaimNotFoundError();
    // AUTHZ-A5: approving credits a courier's ledger. Whose depot the claim came from was
    // never asked, so any holder of `expenseApprove` could move money for any depot.
    assertDepotAccess(reviewer, claim.depotId);
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
