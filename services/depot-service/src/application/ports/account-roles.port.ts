/**
 * The role of each of a set of accounts, from auth-service.
 *
 * Asked by the approval notice: the supervision chain above a depot says WHO reports to whom
 * but not WHAT each person is, and only a role that holds the `approvals` capability can
 * actually decide the item. Answers `null` when the roles cannot be read (not configured, an
 * outage, a refusal) so the caller can fall back rather than mistake "unknown" for "nobody".
 */
export interface AccountRolesPort {
  rolesOf(accountIds: readonly string[]): Promise<Map<string, string> | null>;
}
