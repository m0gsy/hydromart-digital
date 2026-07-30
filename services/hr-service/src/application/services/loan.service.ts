import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, ImportSummary, runImport } from '@hydromart/platform';

import { Loan } from '../../../prisma/generated/client';
import { loanRemainingAfter, loanIsSettled } from '../../domain/loan';
import { LOAN_REPOSITORY, LoanRepository } from '../ports/loan.repository';
import { EmployeeService } from './employee.service';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface LoanView extends Loan {
  /** Outstanding balance as of the current month (computed, not stored). */
  remaining: number;
  settled: boolean;
}

/** Employee loans / kasbon. Deductions are applied automatically by the payroll engine. */
@Injectable()
export class LoanService {
  constructor(
    @Inject(LOAN_REPOSITORY) private readonly repo: LoanRepository,
    private readonly employees: EmployeeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    input: {
      employeeId: string;
      principal: number;
      installmentAmount: number;
      startPeriod: string;
      note?: string;
    },
  ): Promise<Loan> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    if (input.principal <= 0) throw new BadRequestException('principal harus > 0');
    if (input.installmentAmount <= 0) throw new BadRequestException('installmentAmount harus > 0');
    if (!PERIOD_RE.test(input.startPeriod))
      throw new BadRequestException('startPeriod harus format YYYY-MM');
    return this.repo.create({
      employeeId: input.employeeId,
      principal: input.principal,
      installmentAmount: input.installmentAmount,
      startPeriod: input.startPeriod,
      note: input.note ?? null,
      active: true,
      createdBy: user.sub,
    });
  }

  /**
   * Bulk import of running loans (CSV wizard), keyed by staff code — the migration case:
   * kasbon taken out under the old system that payroll must keep deducting.
   *
   * `principal` is what is STILL OWED at `startPeriod`, not the original sum: the engine
   * computes the balance forward from these two numbers, so entering the original amount of
   * a half-paid loan would deduct it twice.
   */
  async importMany(
    user: AuthenticatedUser,
    rows: {
      employeeCode: string;
      principal: number;
      installmentAmount: number;
      startPeriod: string;
      note?: string;
    }[],
  ): Promise<ImportSummary> {
    return runImport(rows, async ({ employeeCode, ...input }) => {
      const employee = await this.employees.getByCode(user, employeeCode);
      const loan = await this.create(user, { ...input, employeeId: employee.id });
      return { status: 'created', id: loan.id };
    });
  }

  /** Stop further deductions (e.g. loan forgiven or settled outside payroll). */
  async deactivate(user: AuthenticatedUser, id: string): Promise<Loan> {
    const loan = await this.repo.findById(id);
    if (!loan) throw new NotFoundException('Pinjaman tidak ditemukan');
    await this.employees.getById(user, loan.employeeId); // depot check
    return this.repo.update(id, { active: false });
  }

  async listByEmployee(
    user: AuthenticatedUser,
    employeeId: string,
    asOfPeriod: string,
  ): Promise<LoanView[]> {
    await this.employees.getById(user, employeeId);
    const period = PERIOD_RE.test(asOfPeriod) ? asOfPeriod : new Date().toISOString().slice(0, 7);
    const loans = await this.repo.listByEmployee(employeeId);
    return loans.map((l) => {
      const terms = {
        principal: Number(l.principal),
        installmentAmount: Number(l.installmentAmount),
        startPeriod: l.startPeriod,
      };
      return {
        ...l,
        remaining: loanRemainingAfter(terms, period),
        settled: loanIsSettled(terms, period),
      };
    });
  }
}
