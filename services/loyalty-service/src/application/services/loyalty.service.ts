import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { startOfLocalMonth } from '@hydromart/platform';

import { LoyaltyConfigService } from '../../config/loyalty-config.service';
import { AdjustmentTooLargeError, InvalidAdjustmentError } from '../../domain/errors';
import { MembershipTier, TierBenefit, benefitFor, tierFor } from '../../domain/membership';
import { PointsTxnType, expiryFrom, pointsForOrder } from '../../domain/points';
import { Page, buildPage } from '../pagination';
import { CustomerDirectory } from '../ports/customer-directory.port';
import {
  LoyaltyAccountRecord,
  LoyaltyRepository,
  PointsTransactionRecord,
  zeroTierCounts,
} from '../ports/loyalty.repository';
import { LOYALTY_TOKENS } from '../tokens';

export interface DepotLoyaltySummary {
  depotId: string;
  totalMembers: number;
  pointsOutstanding: number;
  redeemedThisMonth: number;
  tiers: Record<MembershipTier, number>;
}

export interface EarnResult {
  account: LoyaltyAccountRecord;
  pointsEarned: number;
  /** True when this order had already earned — the call was a no-op (idempotent). */
  alreadyEarned: boolean;
}

export interface ExpiryResult {
  lotsExpired: number;
  pointsExpired: number;
  /**
   * PAR-01: true when the sweep ran and deliberately expired nothing because
   * `pointExpirySweepEnabled` is off. Distinct from `lotsExpired: 0`, which means the
   * sweep ran and found nothing due — the two look identical otherwise, and that
   * ambiguity is how BR-014 stayed unreachable without anyone noticing.
   */
  disabled: boolean;
}

@Injectable()
export class LoyaltyService {
  private static readonly MAX_LIMIT = 100;
  private static readonly EXPIRY_BATCH = 500;
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    @Inject(LOYALTY_TOKENS.LoyaltyRepository) private readonly repo: LoyaltyRepository,
    private readonly config: LoyaltyConfigService,
    @Inject(LOYALTY_TOKENS.CustomerDirectory) private readonly customers: CustomerDirectory,
  ) {}

  /** Read a customer's account, lazily creating it on first touch. */
  async getAccount(customerId: string): Promise<LoyaltyAccountRecord> {
    return (await this.repo.findAccount(customerId)) ?? (await this.repo.createAccount(customerId));
  }

  /** The ladder in force at `depotId` (null = the global one). */
  getTiers(depotId: string | null = null): TierBenefit[] {
    return this.config.tierBenefits(depotId);
  }

  /**
   * The earning rules, for screens that state them in prose.
   *
   * Read from the same config accessors `earn()` prices points with, so the sentence on
   * the screen and the arithmetic behind it cannot disagree — which they did, silently,
   * for every depot that ever changed its rate.
   */
  getRules(depotId: string | null): { earnRateRupiah: number; pointExpiryMonths: number } {
    return {
      earnRateRupiah: this.config.earnRateRupiah(depotId),
      pointExpiryMonths: this.config.pointExpiryMonths(depotId),
    };
  }

  /**
   * A customer's standing as seen from one depot: same points, but the tier and rate are
   * re-derived against that depot's ladder. The stored `tier` column is deliberately left
   * alone — it is the customer's card across the whole network, and letting whichever
   * depot they last shopped at rewrite it would make their history unreadable.
   */
  async getStanding(
    customerId: string,
    depotId: string | null = null,
  ): Promise<{ account: LoyaltyAccountRecord; tier: MembershipTier; discountRate: number }> {
    const account = await this.getAccount(customerId);
    const benefits = this.config.tierBenefits(depotId);
    const tier = tierFor(account.lifetimePoints, benefits);
    return { account, tier, discountRate: benefitFor(tier, benefits).discountRate };
  }

  /**
   * HQ broadcast reach: how many customers are enrolled in loyalty.
   *
   * LOY-9: `depotIds` is a depot-scoped caller's set — a MANAGER was told the network's
   * count. Undefined is the network (head office).
   */
  async countMembers(depotIds?: readonly string[]): Promise<number> {
    if (!depotIds) return this.repo.countAccounts();
    const ids = await this.customerIdsIn(depotIds);
    if (ids.length === 0) return 0;
    const tiers = await this.repo.countByTier(ids);
    return Object.values(tiers).reduce((sum, n) => sum + n, 0);
  }

  /**
   * LOY-4: a staff read of one customer's standing, refused when the customer belongs to
   * none of the caller's depots. The directory fails open to [] — which here reads as
   * "not yours", so an outage refuses rather than reveals.
   */
  async getAccountInScope(
    customerId: string,
    depotIds?: readonly string[],
  ): Promise<LoyaltyAccountRecord> {
    if (depotIds && !(await this.customerIdsIn(depotIds)).includes(customerId)) {
      throw new ForbiddenException('Pelanggan ini bukan pelanggan depot Anda.');
    }
    return this.getAccount(customerId);
  }

  private async customerIdsIn(depotIds: readonly string[]): Promise<string[]> {
    const lists = await Promise.all(depotIds.map((d) => this.customers.customerIdsForDepot(d)));
    return [...new Set(lists.flat())];
  }

  /**
   * Depot-scoped loyalty rollup. Loyalty rows key only on customerId, so we ask
   * customer-service which customers belong to the depot, then aggregate over them.
   * Directory unreachable/empty → zeroed summary (no aggregate queries). `redeemedThisMonth`
   * is measured from the start of the current UTC month.
   */
  async depotSummary(depotId: string, now: Date = new Date()): Promise<DepotLoyaltySummary> {
    const ids = await this.customers.customerIdsForDepot(depotId);
    if (ids.length === 0) {
      return {
        depotId,
        totalMembers: 0,
        pointsOutstanding: 0,
        redeemedThisMonth: 0,
        tiers: zeroTierCounts(),
      };
    }
    // H-16: "this month" started at 07:00 WIB on the 1st, so redemptions in the first
    // seven hours of the month were reported against the previous one.
    const since = startOfLocalMonth(now, this.config.businessTimeZone);
    const [tiers, pointsOutstanding, redeemedThisMonth] = await Promise.all([
      this.repo.countByTier(ids),
      this.repo.sumPointsBalance(ids),
      this.repo.sumRedeemedSince(ids, since),
    ]);
    const totalMembers = Object.values(tiers).reduce((sum, n) => sum + n, 0);
    return { depotId, totalMembers, pointsOutstanding, redeemedThisMonth, tiers };
  }

  async listTransactions(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<Page<PointsTransactionRecord>> {
    const p = Math.max(1, page);
    const l = Math.min(LoyaltyService.MAX_LIMIT, Math.max(1, limit));
    const { items, total } = await this.repo.listTransactions(customerId, p, l);
    return buildPage(items, total, p, l);
  }

  /**
   * Award points for a completed order (BR-013). Idempotent per order: a repeated
   * call for the same orderId is a no-op. A zero-point order (tiny subtotal) records
   * nothing but still reads as handled. `depotId` (the order's depot, when the caller
   * has it) resolves a per-depot override of the earn rate / expiry window; omitted
   * means GLOBAL-only, matching pre-settings behavior.
   */
  async earnForOrder(
    customerId: string,
    orderId: string,
    subtotal: number,
    depotId: string | null = null,
  ): Promise<EarnResult> {
    const existing = await this.repo.findEarnByOrder(orderId);
    if (existing) {
      return { account: await this.getAccount(customerId), pointsEarned: 0, alreadyEarned: true };
    }

    const points = pointsForOrder(subtotal, this.config.earnRateRupiah(depotId));
    const account = await this.getAccount(customerId);
    if (points <= 0) {
      return { account, pointsEarned: 0, alreadyEarned: false };
    }

    const updated = await this.repo.recordEarn({
      accountId: account.id,
      customerId,
      points,
      orderId,
      reason: `Order ${orderId} completed`,
      expiresAt: expiryFrom(new Date(), this.config.pointExpiryMonths(depotId)),
      lifetimeDelta: points,
    });
    return { account: await this.retier(updated), pointsEarned: points, alreadyEarned: false };
  }

  /**
   * Manual signed correction (staff). Positive counts toward lifetime/tier; the
   * balance may never go negative.
   */
  /**
   * Takes back exactly what an order awarded, when that sale is reversed.
   *
   * Scoped by order rather than by an amount the caller supplies: this service owns the
   * per-depot earn rate, so it is the only place that knows what the order actually earned,
   * and a caller recomputing it would claw back the wrong number at every depot that
   * overrode the rate. A sale that never earned (anonymous, or below the threshold) is a
   * no-op, not an error.
   */
  async reverseEarnForOrder(
    customerId: string,
    orderId: string,
    reason: string,
  ): Promise<LoyaltyAccountRecord> {
    const earn = await this.repo.findEarnByOrder(orderId);
    if (!earn || earn.points <= 0) {
      return this.getAccount(customerId);
    }
    /*
     * LOY-7: the owner comes off the EARN row, never off the caller's body.
     *
     * The caller named both the order and the customer, and nothing checked that they
     * matched — so a call naming somebody else's order debited whoever the body said. The
     * ledger already records who earned those points; it is the only answer that can be
     * wrong in only one way.
     */
    const owner = earn.customerId;
    const account = await this.getAccount(owner);
    /*
     * LOY-6 + LOY-7: one reversal per order, and it undoes the whole of what the sale did.
     *
     * It used to go through `adjust`, which (a) refused outright when the customer had
     * already spent the points — leaving the reversed sale's points in circulation forever
     * — and (b) left `lifetimePoints` untouched, so a voided sale still counted towards
     * GOLD. The repository keys the row on the order, so a retried void is a no-op rather
     * than a second debit, and the balance floors at zero instead of refusing: points
     * already spent are a debt the sale created, not a reason to keep minting.
     */
    const updated = await this.repo.recordReversal({
      accountId: account.id,
      customerId: owner,
      orderId,
      points: earn.points,
      reason,
    });
    return this.retier(updated);
  }

  /**
   * LOY-1 + LOY-2: a manual signed correction, fenced to the caller's depots, bounded, and
   * signed by whoever made it.
   *
   * It used to take a customer id and any number at all from anybody holding
   * `loyaltyAdjust` — so a depot MANAGER could mint unlimited points onto any account in
   * the network, and the ledger recorded no actor to ask about it afterwards. Points buy
   * gallons at the counter: this is a money write.
   */
  async adjust(
    customerId: string,
    points: number,
    reason: string,
    actor: { id: string; capped: boolean; depotIds?: readonly string[] },
  ): Promise<LoyaltyAccountRecord> {
    const account = await this.getAccountInScope(customerId, actor.depotIds);
    if (actor.capped) {
      const max = this.config.adjustMaxPoints(null);
      if (Math.abs(points) > max) {
        throw new AdjustmentTooLargeError(max);
      }
    }
    // A friendly rejection before the write; the database repeats the check under the
    // WHERE clause, which is what actually holds when two corrections land together.
    if (account.pointsBalance + points < 0) throw new InvalidAdjustmentError();
    const updated = await this.repo.recordAdjustment({
      type: PointsTxnType.ADJUST,
      accountId: account.id,
      customerId,
      points,
      reason,
      lifetimeDelta: Math.max(0, points),
      createdBy: actor.id,
    });
    return this.retier(updated);
  }

  /**
   * Grant a flat positive reward (e.g. a referral bonus). Counts toward
   * lifetime/tier like an EARN, but is not tied to an order subtotal. Callers
   * (other services) guarantee single-award idempotency; this method always
   * records. `points` must be positive (enforced at the DTO boundary).
   */
  async reward(customerId: string, points: number, reason: string): Promise<LoyaltyAccountRecord> {
    const account = await this.getAccount(customerId);
    const updated = await this.repo.recordAdjustment({
      type: PointsTxnType.REWARD,
      accountId: account.id,
      customerId,
      points,
      reason,
      lifetimeDelta: points,
    });
    return this.retier(updated);
  }

  /**
   * LOY-10 — the loyalty ledger was outside the UU PDP erasure fan-out entirely.
   *
   * Nothing in the deletion path had ever heard of it, so a customer who asked to be
   * forgotten kept every free-text note staff had typed against their points. The points
   * stay (a balance is money owed, and the customer can see it in their own app); the
   * sentences beside them go.
   */
  async anonymise(customerId: string): Promise<{ erased: number }> {
    const erased = await this.repo.scrubReasons(customerId);
    this.logger.log(`PDP: cleared the note on ${erased} ledger row(s)`);
    return { erased };
  }

  /**
   * Re-reads the tier off the lifetime total the database actually holds, and writes it
   * only if it moved (H-2).
   *
   * Global ladder on purpose: the stored tier is the customer's card across the network,
   * not the tier they happen to hold at the depot behind this write.
   */
  private async retier(account: LoyaltyAccountRecord): Promise<LoyaltyAccountRecord> {
    const tier = tierFor(account.lifetimePoints, this.config.tierBenefits(null));
    return tier === account.tier ? account : this.repo.setTier(account.id, tier);
  }

  /**
   * Sweep expired point lots (BR-014). Each due EARN lot becomes a matching negative
   * EXPIRE entry and is marked swept, decrementing the account balance. Idempotent —
   * a swept lot is never picked up again. Meant to be run on a schedule.
   */
  async runExpiry(now: Date = new Date()): Promise<ExpiryResult> {
    // PAR-01. Checked BEFORE the read, not after: a disabled sweep must not even look at
    // which lots are due. Off is the shipped default — see the setting's own note.
    if (!this.config.pointExpirySweepEnabled) {
      return { lotsExpired: 0, pointsExpired: 0, disabled: true };
    }
    const lots = await this.repo.findExpirableLots(now, LoyaltyService.EXPIRY_BATCH);
    let pointsExpired = 0;
    let lotsExpired = 0;
    for (const lot of lots) {
      const account = await this.repo.findAccount(lot.customerId);
      if (!account) continue;
      /*
       * LOY-8: a lot is expired at most once, and never for more than the account holds.
       *
       * The sweep marked the lot by id with no condition, so two runs overlapping — the
       * scheduler and a hand-run, or a retry after a timeout — could both write an EXPIRE
       * for the same lot and debit it twice. And a lot whose points the customer had
       * already spent still expired at full size, taking points that belonged to a later
       * lot with it. The claim is now conditional (the repository reports whether it won),
       * and the debit is capped at the balance actually standing.
       */
      const points = Math.min(lot.points, account.pointsBalance);
      if (points <= 0) {
        // Nothing left to take. The lot is still closed, or the sweep would keep finding it.
        await this.repo.markLotExpired(lot.id);
        continue;
      }
      const claimed = await this.repo.recordExpiry({
        lotId: lot.id,
        accountId: account.id,
        customerId: lot.customerId,
        points,
      });
      if (!claimed) continue;
      pointsExpired += points;
      lotsExpired += 1;
    }
    if (lotsExpired > 0) {
      this.logger.log(`Expired ${pointsExpired} points across ${lotsExpired} lots`);
    }
    return { lotsExpired, pointsExpired, disabled: false };
  }
}
