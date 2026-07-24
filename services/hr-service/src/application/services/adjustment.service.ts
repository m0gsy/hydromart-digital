import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Bonus, BonusType, Deduction, DeductionType } from '../../../prisma/generated/client';
import {
  BONUS_REPOSITORY,
  BonusRepository,
  DEDUCTION_REPOSITORY,
  DeductionRepository,
} from '../ports/adjustment.repository';
import { EmployeeService } from './employee.service';

/** Bonus + deduction entry (both feed the payroll engine). Depot-checked via the employee. */
@Injectable()
export class AdjustmentService {
  constructor(
    @Inject(BONUS_REPOSITORY) private readonly bonuses: BonusRepository,
    @Inject(DEDUCTION_REPOSITORY) private readonly deductions: DeductionRepository,
    private readonly employees: EmployeeService,
  ) {}

  async addBonus(
    user: AuthenticatedUser,
    input: { employeeId: string; type: BonusType; amount: number; periodMonth: string; note?: string },
  ): Promise<Bonus> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    return this.bonuses.create({
      employeeId: input.employeeId,
      type: input.type,
      amount: input.amount,
      periodMonth: input.periodMonth,
      note: input.note ?? null,
      createdBy: user.sub,
    });
  }

  async listBonuses(user: AuthenticatedUser, employeeId: string, periodMonth: string): Promise<Bonus[]> {
    await this.employees.getById(user, employeeId);
    return this.bonuses.listByEmployeePeriod(employeeId, periodMonth);
  }

  async addDeduction(
    user: AuthenticatedUser,
    input: { employeeId: string; type: DeductionType; amount: number; periodMonth: string; note?: string },
  ): Promise<Deduction> {
    await this.employees.getById(user, input.employeeId);
    return this.deductions.create({
      employeeId: input.employeeId,
      type: input.type,
      amount: input.amount,
      periodMonth: input.periodMonth,
      note: input.note ?? null,
      createdBy: user.sub,
    });
  }

  async listDeductions(user: AuthenticatedUser, employeeId: string, periodMonth: string): Promise<Deduction[]> {
    await this.employees.getById(user, employeeId);
    return this.deductions.listByEmployeePeriod(employeeId, periodMonth);
  }
}
