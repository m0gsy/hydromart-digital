/**
 * The idle-session limit head office set, as auth-service needs it.
 *
 * CA-2-06: `idleTimeoutMinutes` lived only in admin-service's own table. It had a screen, a
 * DTO, a repository and a default of fifteen minutes — and not one line outside that
 * service ever read it. A console that lets somebody set a session timeout and then does
 * not time sessions out is worse than one with no such field: it reports a control that
 * does not exist.
 *
 * **Fails OPEN, and that is the whole design.** If admin-service cannot be reached, the
 * answer is "no idle limit", not "everybody is logged out". A security setting that takes
 * the business down when the service holding it restarts is not a security setting, it is
 * an outage with a policy attached. The env-driven refresh TTL still bounds every session,
 * so failing open is a weaker limit rather than none at all.
 */
export interface SecurityPolicyPort {
  /**
   * Minutes a session may sit unused before it must sign in again.
   *
   * `null` means no idle limit — either head office set none, or the policy could not be
   * read. The caller cannot tell those apart on purpose: both mean "do not sign anybody
   * out on my account".
   */
  idleTimeoutMinutes(): Promise<number | null>;
}
