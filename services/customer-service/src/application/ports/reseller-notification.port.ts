/**
 * K4.2. Tells one agen that what they pay has changed.
 *
 * Before this, nothing did. A depot could halve someone's discount or switch them off
 * entirely and the first they knew of it was a cashier reading the new price off a
 * correct screen while they argued about it. The change itself is legitimate; the silence
 * around it was not.
 */
export interface ResellerPriceNotice {
  customerId: string;
  /** What the agen now pays, already rendered — "diskon 5%" / "Rp 5.000 per galon". */
  terms: string;
  /** Whether they are still an agen at all; a deactivation reads nothing like a new rate. */
  active: boolean;
}

/**
 * Fail-open, and it says so: a failed notice never blocks a price change that a depot has
 * decided on. It returns whether the agen was actually told, because the scheduled-change
 * sweep stamps a change as applied either way — the profile moved, and pretending it did
 * not would apply it twice.
 */
export interface ResellerNotificationPort {
  priceChanged(notice: ResellerPriceNotice): Promise<boolean>;
}
