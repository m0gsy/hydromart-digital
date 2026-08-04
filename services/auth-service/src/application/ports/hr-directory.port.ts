/**
 * The employee record behind a staff account.
 *
 * Inviting somebody in the staff console used to create a login and nothing else, so HR
 * had people who could sign in but could not be paid, rostered or clocked in — the mirror
 * image of the HR form creating an employee nobody could log in as.
 *
 * Fails HARD, like hr-service's IdentityPort in the other direction: half a person is
 * worse than a refused invite, and nothing downstream would notice the missing half.
 */
export interface HrDirectoryPort {
  /**
   * Create (or return) the employee row for an account just invited.
   *
   * Idempotent on `authSubjectId`, so re-inviting a phone is a promotion rather than a
   * second employee.
   */
  provisionEmployee(input: ProvisionEmployeeInput): Promise<void>;
}

export interface ProvisionEmployeeInput {
  /** auth-service Customer.id — hr-service stores it as `Employee.authSubjectId`. */
  authSubjectId: string;
  fullName: string;
  phone: string;
  role: string;
  depotId?: string;
  position: string;
  joinDate: string;
  employmentStatus: string;
  salaryType: string;
  dailyRate?: number;
  monthlyRate?: number;
}

export const HR_DIRECTORY_PORT = Symbol('HrDirectoryPort');
