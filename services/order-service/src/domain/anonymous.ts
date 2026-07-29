/**
 * Customer id stamped on a counter sale where the buyer gave no phone number.
 *
 * It is never a real auth subject, and the completion fan-out must keep it away from
 * anything identity-bound: loyalty's getAccount is `findAccount(id) ?? createAccount(id)`,
 * so any UUID it sees mints a real account — an anonymous sale would otherwise leave a
 * phantom balance nobody can ever spend, plus CRM and recommendation rows for a person
 * who does not exist.
 */
export const ANONYMOUS_CUSTOMER_ID = '00000000-0000-0000-0000-000000000000';
