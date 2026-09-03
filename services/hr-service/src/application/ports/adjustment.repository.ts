import { Bonus, BonusType, Deduction, DeductionType } from '../../../prisma/generated/client';

export const BONUS_REPOSITORY = Symbol('BONUS_REPOSITORY');
export const DEDUCTION_REPOSITORY = Symbol('DEDUCTION_REPOSITORY');

export interface BonusRepository {
  create(data: {
    employeeId: string;
    type: BonusType;
    amount: number;
    periodMonth: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<Bonus>;
  listByEmployeePeriod(employeeId: string, periodMonth: string): Promise<Bonus[]>;
  findById(id: string): Promise<Bonus | null>;
  /** CA-1-09: a mistyped row has to be removable while its period is still open. */
  delete(id: string): Promise<void>;
}

export interface DeductionRepository {
  create(data: {
    employeeId: string;
    type: DeductionType;
    amount: number;
    periodMonth: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<Deduction>;
  listByEmployeePeriod(employeeId: string, periodMonth: string): Promise<Deduction[]>;
  findById(id: string): Promise<Deduction | null>;
  /** CA-1-09: a mistyped row has to be removable while its period is still open. */
  delete(id: string): Promise<void>;
}
