/**
 * Flow 6b: what crm needs to send a decision to the accounts that may make it. Both THROW on
 * failure: the caller decides that an unreadable directory means no push (the row is still in
 * the feed), and says so in the log.
 */
export interface ApproverDirectoryPort {
  /** Active staff accounts holding any of these roles, network-wide. */
  staffIdsByRoles(roles: readonly string[]): Promise<string[]>;
  /** The role of each account; an unknown id is absent from the map. */
  rolesOf(ids: readonly string[]): Promise<Map<string, string>>;
  /** AI-7c: the display name (null when none is on file) and role of one account; null when there is no such account. */
  profileOf(id: string): Promise<{ fullName: string | null; role: string } | null>;
}
