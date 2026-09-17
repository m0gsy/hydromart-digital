import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import {
  ExpenseApprovalAboveLimitError,
  ExpenseClaimNotFoundError,
  ExpenseClaimNotPendingError,
  InvalidExpenseAmountError,
} from '../../domain/errors';
import { ExpenseCategory, ExpenseClaimStatus, isAutoApproved } from '../../domain/expense-claim';
import { PayoutConfigService } from '../../config/payout-config.service';
import { CourierLedgerRepository } from '../ports/courier-ledger.repository';
import { ExpenseClaimRecord, ExpenseClaimRepository } from '../ports/expense-claim.repository';
import { PhotoLinkPort } from '../ports/photo-link.port';
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
    @Optional() @Inject(PAYOUT_TOKENS.PhotoLink) private readonly photos?: PhotoLinkPort,
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
      await this.receiptIsProven(receiptUrl),
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

    return this.approveAndCredit(claim, null, 'Disetujui otomatis (di bawah ambang)');
  }

  /**
   * PYO-4 — decide first, then move money.
   *
   * Approval used to credit the ledger and THEN write APPROVED by id alone. Two reviewers
   * acting at once could each pass `loadPending`; one approving and one rejecting left a
   * credited claim that ended REJECTED. The status change now happens first and only if the
   * claim is still pending; the loser is told so and moves nothing. A credit that then fails
   * puts the claim back to PENDING rather than leaving it approved and unpaid.
   */
  private async approveAndCredit(
    claim: ExpenseClaimRecord,
    reviewedBy: string | null,
    note: string | null,
  ): Promise<ExpenseClaimRecord> {
    const approved = await this.claims.markReviewed(claim.id, {
      status: 'APPROVED',
      reviewedBy,
      reviewNote: note,
    });
    if (!approved) throw new ExpenseClaimNotPendingError();
    let entryId: string;
    try {
      entryId = (await this.creditLedger(claim)).id;
    } catch (error) {
      await this.claims.reopen(claim.id);
      throw error;
    }
    return this.claims.attachLedgerEntry(claim.id, entryId);
  }

  /** Reviewer approves a pending claim: credit the courier ledger, then mark it approved. */
  async approve(
    id: string,
    reviewerId: string,
    note?: string,
    reviewer?: AuthenticatedUser,
  ): Promise<ExpenseClaimRecord> {
    const claim = await this.loadPending(id, reviewer);
    // PYO-5: one depot manager approved any amount. Above the network ceiling the claim is
    // FINANCE's (or a super admin's) to decide; rejecting stays open to the manager.
    if (reviewer?.role === 'MANAGER') {
      const limit = this.config.expenseManagerApproveMaxIdr;
      if (claim.amount > limit) throw new ExpenseApprovalAboveLimitError(limit);
    }
    return this.approveAndCredit(claim, reviewerId, note ?? null);
  }

  /** Reviewer rejects a pending claim: no ledger movement. */
  async reject(
    id: string,
    reviewerId: string,
    note?: string,
    reviewer?: AuthenticatedUser,
  ): Promise<ExpenseClaimRecord> {
    await this.loadPending(id, reviewer);
    const rejected = await this.claims.markReviewed(id, {
      status: 'REJECTED',
      reviewedBy: reviewerId,
      reviewNote: note ?? null,
    });
    if (!rejected) throw new ExpenseClaimNotPendingError();
    return rejected;
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
    const { items, total } = await this.claims.searchForDepot(scope, status, page, limit);
    return buildPage(await this.withReceiptLinks(items), total, page, limit);
  }

  /**
   * CA-4-49, step 3 — the receipt a reviewer is approving money against.
   *
   * `receiptUrl` is delivery-service's stored object id, and that bucket is private, so the
   * string opens nothing on its own. Each row gets a freshly minted expiring link instead.
   *
   * Fails SOFT, deliberately: a claim whose link could not be minted comes back with a null
   * receipt and the screen says there is none to show. A reviewer's list must not refuse to
   * load because a peer service is down — that would turn a missing picture into a stopped
   * payout queue.
   */
  private async withReceiptLinks(items: ExpenseClaimRecord[]): Promise<ExpenseClaimRecord[]> {
    if (!this.photos) return items;
    return Promise.all(
      items.map(async (claim) =>
        claim.receiptUrl
          ? { ...claim, receiptUrl: await this.photos!.signedUrl(claim.receiptUrl) }
          : claim,
      ),
    );
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
  private async receiptIsProven(receiptUrl: string | null): Promise<boolean> {
    const base = this.config.receiptStorageBaseUrl;
    if (!receiptUrl || !base || !receiptUrl.startsWith(`${base}/`)) return false;
    /*
     * PYO-1 — the prefix alone was still a string a courier could TYPE, and reuse without
     * limit: `${base}/anything` credited the ledger with no human, as often as asked. Three
     * more things now have to hold, and any doubt sends the claim to a reviewer:
     *   1. the path is the shape an upload produces (`pod/<uuid>.<image ext>`),
     *   2. no other claim already carries it (one receipt, one reimbursement),
     *   3. the object is really there — asked of storage through delivery-service, which
     *      holds the bucket. Unreachable or unconfigured reads as "not proven".
     */
    const rest = receiptUrl.slice(base.length + 1);
    if (!/^(uploads\/)?pod\/[0-9a-f-]{36}\.(jpe?g|png|webp)$/i.test(rest)) return false;
    if ((await this.claims.countByReceiptUrl(receiptUrl)) > 0) return false;
    return (await this.photos?.exists(receiptUrl)) === true;
  }

  private async loadPending(id: string, reviewer?: AuthenticatedUser): Promise<ExpenseClaimRecord> {
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

  /**
   * CA-2-59: the two payout-side cost lines of a depot's month, for the network P&L.
   *
   * One method because both numbers live in this service already, and one HTTP round trip
   * because the caller wants them together — a BFF that asks twice for one screen is two
   * chances for half a P&L.
   *
   * `[from, to)`, half-open, so a month boundary belongs to exactly one month. Depots with
   * nothing are absent from the maps; the caller reads that as zero, which is honest here
   * because these are sums over rows that either exist or do not.
   */
  async costsByDepot(
    depotIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<{ depotId: string; commissionIdr: number; expenseClaimIdr: number }[]> {
    const [commission, claims] = await Promise.all([
      this.ledger.commissionByDepot(depotIds, from, to),
      this.claims.approvedTotalByDepot(depotIds, from, to),
    ]);
    return depotIds.map((depotId) => ({
      depotId,
      commissionIdr: commission.get(depotId) ?? 0,
      expenseClaimIdr: claims.get(depotId) ?? 0,
    }));
  }
}
