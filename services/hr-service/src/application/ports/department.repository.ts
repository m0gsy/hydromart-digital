import { Department } from '../../../prisma/generated/client';

export const DEPARTMENT_REPOSITORY = Symbol('DEPARTMENT_REPOSITORY');

export interface DepartmentWrite {
  code: string;
  name: string;
  depotId: string | null;
  active: boolean;
}

export interface DepartmentRepository {
  create(data: DepartmentWrite): Promise<Department>;
  update(id: string, data: Partial<DepartmentWrite>): Promise<Department>;
  delete(id: string): Promise<void>;
  /**
   * How many employees still sit in this department. `Employee.departmentId` is a plain
   * UUID with no foreign key (MVP, same-service), so Postgres will happily delete the
   * department out from under them and leave the ids dangling — the roster then reads
   * "Belum diatur" for people who were never moved, and the org chart loses a whole unit
   * with no trace of what happened.
   */
  countEmployees(departmentId: string): Promise<number>;
  findById(id: string): Promise<Department | null>;
  /**
   * Departments visible to a depot: its own PLUS the network-wide (null-depot) ones —
   * unlike shifts, which filter on an exact depot. A depot's staff can sit in Finance.
   * Undefined depotId = every department (HQ view).
   */
  list(depotIds?: readonly string[]): Promise<Department[]>;
}
