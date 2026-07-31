export interface PreRegisterResult {
  customerId: string;
  /**
   * created = a new PENDING identity the customer will claim with their first OTP;
   * pending = one already awaiting that OTP; active = the phone already belongs to a
   * verified account, left untouched.
   */
  status: 'created' | 'pending' | 'active';
}

/** The account-side identity of one customer. Both fields may be blank on a PENDING account. */
export interface CustomerIdentity {
  fullName: string | null;
  phone: string | null;
}

/**
 * Identity provisioning and lookup against auth-service, which owns the account row.
 *
 * `preRegisterCustomer` fails HARD: it is the caller's own write, so a row whose identity
 * can't be created must be reported, not silently dropped. `getCustomerNames` is the
 * opposite — a read that decorates a directory listing, so it fails SOFT and the caller
 * falls back to whatever name it already had.
 */
export interface IdentityPort {
  preRegisterCustomer(phone: string, fullName?: string): Promise<PreRegisterResult>;

  /** Account name/phone by customer id. Ids with no account are simply absent from the map. */
  getCustomerNames(ids: string[]): Promise<Map<string, CustomerIdentity>>;
}
