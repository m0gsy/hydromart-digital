import { MessageLocale } from '../../domain/notification-event';

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
  /**
   * K5.3: which language to write this customer's messages in.
   *
   * Same directory, same reason it is not kept here: customer-service owns the profile, and
   * a second copy would drift the first time somebody switched language. Also FAILS OPEN,
   * to Indonesian — an unreadable preference costs a reader their language, never the
   * message. Anything that is not a language we hold is treated the same way.
   */
  localeFor(customerId: string): Promise<MessageLocale>;
  /**
   * F1b: whether this customer still accepts promotional messages.
   *
   * An OPT-OUT, not an opt-in, and that is a recorded decision rather than an oversight.
   * The consent ledger writes no MARKETING row for anybody who was never offered the
   * checkbox — "never asked is not a refusal" — so almost every existing customer has no
   * row at all. Filtering to consent-granted-only would empty the audience rather than
   * narrow it. The position taken instead: an existing customer of a depot may be told
   * about that depot, through a row in their own in-app feed, and may switch it off at any
   * time in one tap. This is that switch.
   *
   * Also fails open. The durable gate is the audience query in customer-service, which has
   * no failure mode at all; this one is the backstop for a pasted recipient list, and an
   * outage must not silently abandon a campaign.
   */
  marketingAllowed(customerId: string): Promise<boolean>;
}
