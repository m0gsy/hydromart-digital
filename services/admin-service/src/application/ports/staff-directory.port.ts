/** A login as the staff email needs it: where to write, and whether it may be told at all. */
export interface StaffAccount {
  id: string;
  email: string | null;
  role: string;
  status: string;
}

/**
 * auth-service's accounts by id (the login's own email, the one /hq/profile shows). THROWS when
 * the directory cannot answer; an unknown id is simply absent.
 */
export interface StaffDirectoryPort {
  accountsByIds(ids: readonly string[]): Promise<StaffAccount[]>;
}
