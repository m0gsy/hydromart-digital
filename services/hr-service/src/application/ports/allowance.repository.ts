import { Allowance, AllowanceType } from '../../../prisma/generated/client';

export const ALLOWANCE_REPOSITORY = Symbol('ALLOWANCE_REPOSITORY');

export interface AllowanceWrite {
  employeeId: string;
  type: AllowanceType;
  amount: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
  note: string | null;
  createdBy: string | null;
}

export interface AllowanceRepository {
  create(data: AllowanceWrite): Promise<Allowance>;
  update(id: string, data: Partial<Omit<AllowanceWrite, 'employeeId'>>): Promise<Allowance>;
  findById(id: string): Promise<Allowance | null>;
  listByEmployee(employeeId: string): Promise<Allowance[]>;
  /**
   * Active allowances covering a period: started on or before the period end, and either
   * open-ended or ended on or after the period start. Anything that lapsed earlier is not paid.
   */
  listActiveForPeriod(employeeId: string, from: Date, to: Date): Promise<Allowance[]>;
}
