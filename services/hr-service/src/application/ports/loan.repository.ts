import { Loan } from '../../../prisma/generated/client';

export const LOAN_REPOSITORY = Symbol('LOAN_REPOSITORY');

export interface LoanWrite {
  employeeId: string;
  principal: number;
  installmentAmount: number;
  startPeriod: string;
  note: string | null;
  active: boolean;
  createdBy: string | null;
}

export interface LoanRepository {
  create(data: LoanWrite): Promise<Loan>;
  update(id: string, data: Partial<Pick<LoanWrite, 'active' | 'note'>>): Promise<Loan>;
  findById(id: string): Promise<Loan | null>;
  listByEmployee(employeeId: string): Promise<Loan[]>;
  /** Active loans for an employee (drives the auto payroll deduction). */
  listActiveByEmployee(employeeId: string): Promise<Loan[]>;
}
