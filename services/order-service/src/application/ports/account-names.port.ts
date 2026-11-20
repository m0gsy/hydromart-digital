/**
 * The display name of an account, for "Dikoreksi oleh X" (owner decision 2026-11-20). Never
 * throws: null when the account is unknown or the directory cannot be read — the note then
 * says when and why, without a name.
 */
export interface AccountNamesPort {
  nameOf(accountId: string): Promise<string | null>;
}
