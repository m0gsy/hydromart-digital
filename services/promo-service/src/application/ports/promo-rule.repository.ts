import { PromoRuleCandidate } from '../../domain/promo-rule';

export interface PromoRuleRecord extends PromoRuleCandidate {
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePromoRuleData = Omit<PromoRuleRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>;

export type UpdatePromoRuleData = Partial<CreatePromoRuleData> & { active?: boolean };

/** How often a rule has actually fired, from the PromoApplication audit trail. */
export interface PromoRuleUsage {
  promoRuleId: string;
  /** Distinct orders the rule applied to. */
  orders: number;
  /** Rupiah the rule took off, summed over its audit rows. */
  totalDiscount: number;
  lastAppliedAt: Date | null;
}

/** One order a rule applied to, with what the rule took off that order. */
export interface PromoRuleOrderSample {
  promoRuleId: string;
  orderId: string;
  /** Rupiah this rule took off this order, summed over its audit rows. */
  discount: number;
}

/** One audit row of a rule taking something off an order, inside a report window. */
export interface PromoApplicationInWindow {
  promoRuleId: string;
  ruleName: string;
  orderId: string;
  discount: number;
}

export interface PromoRuleRepository {
  findById(id: string): Promise<PromoRuleRecord | null>;
  create(data: CreatePromoRuleData): Promise<PromoRuleRecord>;
  update(id: string, data: UpdatePromoRuleData): Promise<PromoRuleRecord>;
  delete(id: string): Promise<void>;

  /**
   * All rules visible to the caller (admin listing). `depotIds` undefined = network-wide
   * caller, sees every rule. Otherwise sees network-wide rules (depotId null) PLUS rules
   * scoped to one of `depotIds`.
   */
  findAll(depotIds?: readonly string[]): Promise<PromoRuleRecord[]>;

  /**
   * Usage for every rule visible to the caller (same visibility as `findAll`). A rule that
   * has never fired has no row here: absence means zero, and the caller fills it in.
   */
  usageByRule(depotIds?: readonly string[]): Promise<PromoRuleUsage[]>;

  /**
   * For every visible rule, its `perRule` most recently applied orders (each order once) with
   * the discount the rule gave on it. A sample, not the history: the order values have to be
   * fetched from order-service, and a busy rule has more orders than one dashboard load can ask
   * for. `depotIds` narrows the rules exactly as {@link usageByRule} does.
   */
  recentOrdersByRule(
    depotIds: readonly string[] | undefined,
    perRule: number,
  ): Promise<PromoRuleOrderSample[]>;

  /**
   * Active rules a checkout at `depotId` may match at `now`: `active=true`, depot-visible
   * (network-wide or that depot), and filtered by `validFrom`/`validUntil` against `now` —
   * day-of-week/time-of-day/channel/qty matching happens in the pure domain layer, which
   * needs the full candidate shape anyway. `depotIds` here is always a single-element array
   * (the fulfilling depot) or `[]` for a network-wide-only quote; see PromoRuleService.quote.
   */
  findActiveCandidates(
    depotIds: readonly string[] | undefined,
    now: Date,
  ): Promise<PromoRuleCandidate[]>;

  /**
   * Atomically writes every audit row for one order's apply() call, or none at all. The
   * unique constraint on (orderId, promoRuleId, productId) is the real idempotency guard
   * under concurrency/retries — `hasApplicationFor`'s pre-check in the service is the cheap
   * common-case exit, same two-layer discipline as VoucherRepository.redeemAtomic.
   */
  recordApplications(
    orderId: string,
    rows: { promoRuleId: string; productId: string | null; discountValue: number }[],
  ): Promise<void>;

  /**
   * Audit rows written in [from, to), oldest first, at most limit. A scheduled report asks
   * for cap + 1 so it can tell a cut-off window from a complete one.
   */
  applicationsInWindow(from: Date, to: Date, limit: number): Promise<PromoApplicationInWindow[]>;

  /** True if any PromoApplication row already exists for this order (idempotency check). */
  hasApplicationFor(orderId: string): Promise<boolean>;
}
