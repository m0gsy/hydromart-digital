import {
  Employee,
  EmploymentHistory,
  EmployeeStatus,
  Prisma,
} from '../../../prisma/generated/client';

export const EMPLOYEE_REPOSITORY = Symbol('EMPLOYEE_REPOSITORY');

export interface EmployeeListFilter {
  /** Restrict to one depot (tenant isolation). Undefined = all depots (HQ view). */
  depotId?: string;
  status?: EmployeeStatus;
  /** Case-insensitive match on fullName / employeeCode / phone. */
  search?: string;
  skip: number;
  take: number;
}

export interface EmployeeRepository {
  /** Row count, used to mint the next sequential employeeCode. */
  count(): Promise<number>;
  /**
   * Retention (M23-21): how many departed employee records have sat untouched since
   * before `cutoff`. Counting only — ACTIVE staff are never eligible, and nothing here
   * deletes: an employment record can be evidence in a labour dispute, and attendance
   * and payroll rows point at it.
   */
  countRetentionEligible(cutoff: Date): Promise<number>;
  list(filter: EmployeeListFilter): Promise<{ rows: Employee[]; total: number }>;
  findById(id: string): Promise<Employee | null>;
  /** Resolve the HR record linked to an auth account (self-service check-in/profile). */
  findByAuthSubjectId(authSubjectId: string): Promise<Employee | null>;
  /** Change log for one employee, newest first. */
  listHistory(employeeId: string): Promise<EmploymentHistory[]>;
  /** Create the employee and (optionally) its first employment-history row atomically. */
  create(
    data: Prisma.EmployeeCreateInput,
    history?: Prisma.EmploymentHistoryCreateWithoutEmployeeInput,
  ): Promise<Employee>;
  /** Update the employee and append any change-history rows atomically. */
  update(
    id: string,
    data: Prisma.EmployeeUpdateInput,
    history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[],
  ): Promise<Employee>;
}
