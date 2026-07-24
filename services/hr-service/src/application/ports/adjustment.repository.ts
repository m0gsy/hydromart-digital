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
}
