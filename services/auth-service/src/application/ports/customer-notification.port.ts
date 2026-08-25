/**
 * Port for notifying a newly-registered customer (welcome message). Fired after
 * successful phone verification. The concrete adapter calls crm-service over the
 * internal service-auth path; it MUST fail open so a notification outage never
 * blocks registration.
 */
export interface CustomerNotificationPort {
  sendWelcome(phone: string, name: string): Promise<void>;
  /**
   * K1.4. Tells the number that has just STOPPED being the login identity that it has.
   *
   * This is the only warning a hijack produces. Everything else about a stolen phone
   * change is invisible to the person losing the account: they are not signed out of
   * anything they are looking at, and the next thing that fails is an OTP they will read
   * as a network problem. The message goes to the OLD number, names the new one masked,
   * and is sent after the change rather than before — before, it would be a warning about
   * something that had not happened, and after a failed attempt it would be noise.
   *
   * Fail-open like the welcome: the change has already been made and proved.
   */
  sendPhoneChanged(oldPhone: string, newPhoneMasked: string, name: string): Promise<void>;
}
