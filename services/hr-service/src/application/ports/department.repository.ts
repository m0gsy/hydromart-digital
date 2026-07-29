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
  findById(id: string): Promise<Department | null>;
  /**
   * Departments visible to a depot: its own PLUS the network-wide (null-depot) ones —
   * unlike shifts, which filter on an exact depot. A depot's staff can sit in Finance.
   * Undefined depotId = every department (HQ view).
   */
  list(depotId?: string): Promise<Department[]>;
}
