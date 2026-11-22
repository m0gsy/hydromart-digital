import { EmployeeLegalEntityHistory, EmployeeLegalEntityPoint } from '../../domain/legal-entity';

export const EMPLOYEE_LEGAL_ENTITY_REPOSITORY = Symbol('EmployeeLegalEntityRepository');

export interface AssignEmployeesData {
  employeeIds: string[];
  legalEntityId: string;
  /** UTC midnight of the calendar day (a `@db.Date`). */
  effectiveFrom: Date;
  recordedBy: string | null;
}

/** An employee whose point on that day was written: `replaced` = the entity it had there before, if any. */
export interface AssignedEmployee {
  employeeId: string;
  replaced: string | null;
}

export interface EmployeeLegalEntityRepository {
  /** Every employee, by code, with their change points newest first. */
  histories(): Promise<EmployeeLegalEntityHistory[]>;
  /** The ones of these ids that are employees. */
  existingEmployeeIds(ids: string[]): Promise<string[]>;
  /**
   * One change point per employee on that day, in one statement: a new day is a new point, an
   * existing day is corrected in place. Returns only the employees whose row was written.
   */
  assign(data: AssignEmployeesData): Promise<AssignedEmployee[]>;
  /** Deletes one change point and returns it, or null when there is none with that id. */
  remove(id: string): Promise<EmployeeLegalEntityPoint | null>;
}
