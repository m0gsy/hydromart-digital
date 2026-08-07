export const SUPERVISION_PORT = Symbol('SupervisionPort');

/**
 * Who an employee reports to, read from depot-service's `staff_supervision` table.
 *
 * That table is now the ONE place a reporting line is written (the HQ hierarchy page), so
 * this service stopped writing and reading `Employee.supervisorId`. Keeping the local
 * column as the source would mean approving leave against a line nobody maintains.
 *
 * Fail-SOFT at every call site here, matching the notification port next to it: a
 * supervisor lookup that fails must never reject somebody's leave request.
 */
export interface SupervisionPort {
  /** auth-service account id of the superior, or null when none is recorded. */
  superiorOf(authSubjectId: string): Promise<string | null>;

  /**
   * Record a reporting line, by account id on both sides.
   *
   * Throws, unlike the read: the CSV import's `atasan` column is a request the person
   * uploading the file expects to see the result of, so a refusal (a cycle, an unknown
   * account) is reported on that row rather than dropped.
   */
  setSuperior(authSubjectId: string, superiorAuthSubjectId: string): Promise<void>;
}
