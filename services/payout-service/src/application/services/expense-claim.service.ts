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
  async submit(
    courierId: string,
    input: SubmitExpenseInput,
    courier?: AuthenticatedUser,
  ): Promise<ExpenseClaimRecord> {
    if (!(input.amount > 0)) throw new InvalidExpenseAmountError();
    /*
     * AUTHZ-B3 — the depot comes from the TOKEN, not the form.
     *
     * `depotId` decides two things: whose books the claim lands on, and — through
     * `expenseAutoApproveMaxIdr(depotId)` — the threshold under which it credits the
     * courier's ledger with no human in the loop. Both were read straight off the request
     * body. A courier could name any depot in the network, pick whichever had the highest
     * auto-approve ceiling, and file against it; the same file already calls
     * `assertDepotAccess` on the review path (AUTHZ-A5, `loadPending`) and on the queue,
     * so the submit path was the one door left open.
     *
     * The body value stays accepted only when it agrees with the caller's own scope, so an
     * internal caller with no principal and the existing tests keep working; a courier who
     * names somebody else's depot is refused rather than quietly re-pointed.
     */
    const claimed = input.depotId ?? null;
    if (courier && claimed) assertDepotAccess(courier, claimed);
    const depotId = claimed ?? courier?.depotId ?? null;
    const receiptUrl = input.receiptUrl?.trim() || null;
    const auto = isAutoApproved(
      input.amount,
      this.config.expenseAutoApproveMaxIdr(depotId),
      this.receiptIsOurs(receiptUrl),
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

  /**
   * Whether this receipt is one THIS platform stored.
   *
   * `isAutoApproved` treats "a receipt is attached" as proof enough to credit a courier's
   * ledger with no reviewer in the loop, and the only thing behind that was
   * `receiptUrl !== null` — so the literal string `x` bought an auto-approval. A tightening
   * to "any http(s) URL" only raised the bar to typing one.
   *
   * So the bar is where the receipt actually comes from: the object storage the courier app
   * uploads to. A courier can no longer describe a receipt into existence; they have to
   * photograph one, and the upload is what produces a URL under this prefix.
   *
   * Blank config = OFF, not "accept anything". A deployment that has not said where receipts
   * live cannot tell a real one from a typed one, and the safe reading of "I cannot tell" is
   * a claim that waits for a human.
   */
  private receiptIsOurs(receiptUrl: string | null): boolean {
    const base = this.config.receiptStorageBaseUrl;
    if (!receiptUrl || !base) return false;
    // Prefix plus a separator: `https://cdn/hydromart-pod` must not admit
    // `https://cdn/hydromart-pod-evil/…`, which starts with it.
    return receiptUrl.startsWith(`${base}/`);
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
