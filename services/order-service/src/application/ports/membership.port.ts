/**
 * Resolves the checkout customer's membership tier discount rate (FR-032).
 *
 * The rate is an implicit, always-on benefit (not something the customer explicitly
 * requested at this checkout), so implementations fail OPEN: any error yields a 0
 * rate and checkout proceeds without the membership discount rather than being
 * blocked by a loyalty-service outage.
 */
/**
 * A tier rate, and whether it is a fact.
 *
 * E-5: this used to be a bare `number`, so "this customer's tier is worth nothing" and "we
 * could not ask loyalty-service" arrived as the same 0. A PLATINUM customer was billed full
 * price during a loyalty outage with nothing on the order, in any log, to say why — the
 * question "kenapa harga saya penuh" had no answer anywhere in the system. The behaviour is
 * unchanged (checkout still proceeds at 0); what changes is that the caller can now tell.
 */
export interface MembershipRate {
  /** Fractional discount in [0, 1). */
  rate: number;
  /** True when the rate could not be read at all. `rate` is then 0 by fallback, not by fact. */
  unavailable: boolean;
}

export interface MembershipPort {
  /**
   * Fractional discount rate in [0, 1) for the caller's tier; 0 when unavailable.
   * `depotId` is the fulfilling depot: it decides both the thresholds the customer's
   * points are judged against and what that tier is worth there. Omitted means the
   * global ladder.
   */
  getDiscountRate(authorization: string, depotId?: string | null): Promise<MembershipRate>;

  /**
   * The same rate for a named customer, over the internal service path. A counter sale is
   * rung up on the cashier's token, so the token cannot say whose tier to price — asking
   * by token there would hand the buyer the CASHIER's discount. Fails OPEN the same way.
   */
  getDiscountRateFor(customerId: string, depotId?: string | null): Promise<MembershipRate>;
}
