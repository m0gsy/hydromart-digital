import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, ImportSummary, runImport } from '@hydromart/platform';

import { Allowance, AllowanceType } from '../../../prisma/generated/client';
import { ALLOWANCE_REPOSITORY, AllowanceRepository } from '../ports/allowance.repository';
import { EmployeeService } from './employee.service';

export interface AllowanceInput {
  employeeId: string;
  type: AllowanceType;
  amount: number;
  effectiveFrom: string;
  effectiveTo?: string;
  note?: string;
}

/**
 * Recurring pay components. A bonus is one row for one period; an allowance repeats every
 * month until it lapses, which is why it lives in its own table rather than as a Bonus type.
 * Depot-checked through the employee, like bonuses and deductions.
 */
@Injectable()
export class AllowanceService {
  constructor(
    @Inject(ALLOWANCE_REPOSITORY) private readonly repo: AllowanceRepository,
    private readonly employees: EmployeeService,
  ) {}

  async add(user: AuthenticatedUser, input: AllowanceInput): Promise<Allowance> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    const from = new Date(input.effectiveFrom);
    const to = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (to && to < from) {
      throw new BadRequestException('effectiveTo tidak boleh sebelum effectiveFrom');
    }
    return this.repo.create({
      employeeId: input.employeeId,
      type: input.type,
      amount: input.amount,
      effectiveFrom: from,
      effectiveTo: to,
      active: true,
      note: input.note ?? null,
      createdBy: user.sub,
    });
  }

  /**
   * Bulk import (CSV wizard). Rows are keyed by staff code, and each one is simply added:
   * an allowance is a dated row, not a unique fact about a person, so re-uploading the same
   * file duplicates rather than skipping. That is the honest behaviour — the operator sees
   * the duplicate in the list and deactivates it, which beats guessing which of two
   * identical-looking transport allowances was meant.
   */
  async importMany(
    user: AuthenticatedUser,
    rows: (Omit<AllowanceInput, 'employeeId'> & { employeeCode: string })[],
  ): Promise<ImportSummary> {
    return runImport(rows, async ({ employeeCode, ...input }) => {
      const employee = await this.employees.getByCode(user, employeeCode);
      const allowance = await this.add(user, { ...input, employeeId: employee.id });
      return { status: 'created', id: allowance.id };
    });
  }

  async list(user: AuthenticatedUser, employeeId: string): Promise<Allowance[]> {
    await this.employees.getById(user, employeeId);
    return this.repo.listByEmployee(employeeId);
  }

  /**
   * Stopping an allowance closes it, it does not erase it: a past payslip was computed from
   * these rows and must stay explainable.
   */
  async deactivate(user: AuthenticatedUser, id: string): Promise<Allowance> {
    const allowance = await this.repo.findById(id);
    if (!allowance) throw new NotFoundException('Tunjangan tidak ditemukan');
    await this.employees.getById(user, allowance.employeeId); // depot check
    return this.repo.update(id, { active: false });
  }
}
