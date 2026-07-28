export interface PreRegisterResult {
  customerId: string;
  /**
   * created = a new PENDING identity the customer will claim with their first OTP;
   * pending = one already awaiting that OTP; active = the phone already belongs to a
   * verified account, left untouched.
   */
  status: 'created' | 'pending' | 'active';
}

/**
 * Identity provisioning for depot-staff imports. Creates the account as PENDING only —
 * the customer still signs up themselves with the number the depot registered, and
 * that OTP is what activates it. Fails HARD: a row whose identity can't be created
 * must be reported, not silently dropped.
 */
export interface IdentityPort {
  preRegisterCustomer(phone: string, fullName?: string): Promise<PreRegisterResult>;
}
