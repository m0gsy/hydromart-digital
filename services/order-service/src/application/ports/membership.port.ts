/**
 * Resolves the checkout customer's membership tier discount rate (FR-032).
 *
 * The rate is an implicit, always-on benefit (not something the customer explicitly
 * requested at this checkout), so implementations fail OPEN: any error yields a 0
 * rate and checkout proceeds without the membership discount rather than being
 * blocked by a loyalty-service outage.
 */
export interface MembershipPort {
  /**
   * Fractional discount rate in [0, 1) for the caller's tier; 0 when unavailable.
   * `depotId` is the fulfilling depot: it decides both the thresholds the customer's
   * points are judged against and what that tier is worth there. Omitted means the
   * global ladder.
   */
  getDiscountRate(authorization: string, depotId?: string | null): Promise<number>;
}
