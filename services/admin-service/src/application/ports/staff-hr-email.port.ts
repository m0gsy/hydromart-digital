/**
 * hr-service's email for each login (Employee.email, linked by Employee.authSubjectId): the
 * address HR keeps for the person, preferred over the login's own. THROWS when HR cannot
 * answer; an account with no HR email is simply absent.
 */
export interface StaffHrEmailPort {
  emailsByAccounts(accountIds: readonly string[]): Promise<{ accountId: string; email: string }[]>;
}
