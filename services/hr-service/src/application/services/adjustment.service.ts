import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, ImportSummary, runImport } from '@hydromart/platform';

import { Bonus, BonusType, Deduction, DeductionType } from '../../../prisma/generated/client';
import {
  BONUS_REPOSITORY,
  BonusRepository,
  DEDUCTION_REPOSITORY,
  DeductionRepository,
} from '../ports/adjustment.repository';
import { PAYROLL_REPOSITORY, PayrollRepository } from '../ports/payroll.repository';
import { EmployeeService } from './employee.service';

/** Bonus + deduction entry (both feed the payroll engine). Depot-checked via the employee. */
@Injectable()
export class AdjustmentService {
  constructor(
    @Inject(BONUS_REPOSITORY) private readonly bonuses: BonusRepository,
    @Inject(DEDUCTION_REPOSITORY) private readonly deductions: DeductionRepository,
    private readonly employees: EmployeeService,
    @Inject(PAYROLL_REPOSITORY) private readonly payrolls: PayrollRepository,
  ) {}

  /**
   * CA-1-08 — a period whose payslip is already signed off takes no more adjustments.
   *
   * A bonus is only ever paid by `PayrollService.generate`, and `generate` REFUSES to re-run
   * once the payroll leaves DRAFT. So a bonus typed against an APPROVED period was written,
   * listed back on the screen that wrote it, and then paid to nobody — the row existed, the
   * money did not, and nothing anywhere said so. HR found out when the employee did.
   *
   * Refusing at entry is the only place a person still has the chance to put it in the next
   * period instead, so the message says to do that. The same guard covers deletion: removing
   * a line an APPROVED payslip already counted would rewrite what was paid.
   */
  private async assertPeriodOpen(employeeId: string, periodMonth: string): Promise<void> {
    const payroll = await this.payrolls.findByEmployeeAndPeriod(employeeId, periodMonth);
    if (payroll && payroll.status !== 'DRAFT') {
      throw new ConflictException(
        `Payroll ${periodMonth} sudah ${payroll.status}, jadi bonus/potongan periode itu tidak ` +
          'bisa diubah lagi. Catat di periode berikutnya.',
      );
    }
  }

  async addBonus(
    user: AuthenticatedUser,
    input: {
      employeeId: string;
      type: BonusType;
      amount: number;
      periodMonth: string;
      note?: string;
    },
  ): Promise<Bonus> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    await this.assertPeriodOpen(input.employeeId, input.periodMonth);
    return this.bonuses.create({
      employeeId: input.employeeId,
      type: input.type,
      amount: input.amount,
      periodMonth: input.periodMonth,
      note: input.note ?? null,
      createdBy: user.sub,
    });
  }

  async listBonuses(
    user: AuthenticatedUser,
    employeeId: string,
    periodMonth: string,
  ): Promise<Bonus[]> {
    await this.employees.getById(user, employeeId);
    return this.bonuses.listByEmployeePeriod(employeeId, periodMonth);
  }

  async addDeduction(
    user: AuthenticatedUser,
    input: {
      employeeId: string;
      type: DeductionType;
      amount: number;
      periodMonth: string;
      note?: string;
    },
  ): Promise<Deduction> {
    await this.employees.getById(user, input.employeeId);
    await this.assertPeriodOpen(input.employeeId, input.periodMonth);
    return this.deductions.create({
      employeeId: input.employeeId,
      type: input.type,
      amount: input.amount,
      periodMonth: input.periodMonth,
      note: input.note ?? null,
      createdBy: user.sub,
    });
  }

  /**
   * Bulk import of deductions (CSV wizard), keyed by staff code. Like allowances, a row is
   * appended rather than matched: two MANUAL deductions of the same amount in the same month
   * are a legitimate pair, so nothing here may collapse them.
   */
  async importDeductions(
    user: AuthenticatedUser,
    rows: {
      employeeCode: string;
      type: DeductionType;
      amount: number;
      periodMonth: string;
      note?: string;
    }[],
  ): Promise<ImportSummary> {
    return runImport(rows, async ({ employeeCode, ...input }) => {
      const employee = await this.employees.getByCode(user, employeeCode);
      const deduction = await this.addDeduction(user, { ...input, employeeId: employee.id });
      return { status: 'created', id: deduction.id };
    });
  }

  async listDeductions(
    user: AuthenticatedUser,
    employeeId: string,
    periodMonth: string,
  ): Promise<Deduction[]> {
    await this.employees.getById(user, employeeId);
    return this.deductions.listByEmployeePeriod(employeeId, periodMonth);
  }

  /**
   * CA-1-09 — remove a bonus typed by mistake.
   *
   * There was no way to, from any screen or any route: a 500.000 bonus entered as 5.000.000
   * could only be cancelled by typing a 4.500.000 DEDUCTION against the same month, which is
   * what depots were doing, and the payslip then carried both lines. Hard delete rather than
   * a flag, because a row nobody has been paid for is not history — `assertPeriodOpen` is
   * what keeps it that way, and a period already approved refuses.
   */
  async removeBonus(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.bonuses.findById(id);
    if (!row) throw new NotFoundException('Bonus tidak ditemukan');
    await this.employees.getById(user, row.employeeId); // 404 + depot check
    await this.assertPeriodOpen(row.employeeId, row.periodMonth);
    await this.bonuses.delete(id);
  }

  /** CA-1-09, the deduction half. Same rule: only while the period is still DRAFT. */
  async removeDeduction(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.deductions.findById(id);
    if (!row) throw new NotFoundException('Potongan tidak ditemukan');
    await this.employees.getById(user, row.employeeId);
    await this.assertPeriodOpen(row.employeeId, row.periodMonth);
    await this.deductions.delete(id);
  }
}
