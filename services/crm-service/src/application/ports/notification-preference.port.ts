/**
 * F1: whether a customer still wants push at all.
 *
 * `/account` has offered a push toggle since the account screen was built, customer-service
 * has stored it since then, and nothing on the sending side ever read it — so the switch
 * moved a row in a table and changed nothing a customer could observe. Under UU PDP a
 * control that is presented as a choice has to be one.
 *
 * The preference lives in customer-service because that is where the customer's profile
 * lives; crm asks rather than keeping a second copy that would drift the first time
 * somebody toggled it.
 *
 * Implementations FAIL OPEN — an unreachable directory answers `true`. This is the
 * opposite of `ActivitySegmentPort`, deliberately: a segment that fails closed loses a
 * campaign nobody has sent yet, while a preference that fails closed silently stops an
 * order-status push somebody is waiting on. The mute is a preference, not a legal bar;
 * the marketing consent that IS one is a separate question and not this port's job.
 */
export interface NotificationPreferencePort {
  pushAllowed(customerId: string): Promise<boolean>;
}
