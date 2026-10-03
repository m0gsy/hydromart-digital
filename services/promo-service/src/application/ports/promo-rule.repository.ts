import { PromoRuleCandidate } from '../../domain/promo-rule';

export interface PromoRuleRecord extends PromoRuleCandidate {
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePromoRuleData = Omit<PromoRuleRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>;

export type UpdatePromoRuleData = Partial<CreatePromoRuleData> & { active?: boolean };

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

  /** True if any PromoApplication row already exists for this order (idempotency check). */
  hasApplicationFor(orderId: string): Promise<boolean>;
}
