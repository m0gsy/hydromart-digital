import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuthenticatedUser,
  depotScopeIds,
  ImportSummary,
  localDayKey,
  localMonthKey,
  runImport,
} from '@hydromart/platform';

import { Loan } from '../../../prisma/generated/client';
import { loanRemainingAfter, loanIsSettled, nextPeriod } from '../../domain/loan';
import { HrConfigService } from '../../config/hr-config.service';
import { LOAN_REPOSITORY, LoanListRow, LoanRepository } from '../ports/loan.repository';
import { PAYROLL_REPOSITORY, PayrollRepository } from '../ports/payroll.repository';
import { EmployeeService } from './employee.service';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Rows a scheduled-report table may carry; admin-service's contract caps tables here. */
const REPORT_ROW_CAP = 5000;

export interface LoanReportTable {
  columns: { key: string; label: string; type: 'text' | 'int' | 'money' | 'date' | 'percent' }[];
  rows: (string | number | null)[][];
  truncated: boolean;
}

interface ReportAgg {
  name: string;
  code: string;
  loans: number;
  principal: number;
  repaid: number;
  remaining: number;
  installment: number;
  oldest: Date;
}

/** A network-wide row: the same computed balance, plus who it belongs to. */
export interface LoanListView extends LoanListRow {
  remaining: number;
  settled: boolean;
}

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
    private readonly config: HrConfigService,
    @Inject(PAYROLL_REPOSITORY) private readonly payrolls: PayrollRepository,
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
    return this.viewsFor(employeeId, asOfPeriod);
  }

  /** What this person still owes on every unsettled loan, as of now. Internal: no access check. */
  async openBalance(employeeId: string): Promise<number> {
    const views = await this.viewsFor(employeeId, '');
    return views.reduce((sum, l) => sum + (l.settled ? 0 : l.remaining), 0);
  }

  private async viewsFor(employeeId: string, asOfPeriod: string): Promise<LoanView[]> {
    // C2: the fallback period is the LOCAL month. `toISOString().slice(0, 7)` is the UTC
    // month, so for the first seven hours of the 1st WIB it still said last month — an
    // employee opening their kasbon at 06:00 on 1 August was shown July's balance.
    const period = PERIOD_RE.test(asOfPeriod)
      ? asOfPeriod
      : localMonthKey(new Date(), this.config.timeZone);
    const loans = await this.repo.listByEmployee(employeeId);
    // CA-1-05: the balance is what payroll REALLY took, not what the calendar says it should
    // have. `deductedBySourceRefBefore` is the same repayment ledger the deduction itself
    // reads (D4), and "YYYY-MM" sorts as it dates, so asking for everything before the NEXT
    // period is exactly "every payslip up to and including this one".
    const repaid = await this.payrolls.deductedBySourceRefBefore(
      employeeId,
      nextPeriod(period),
      loans.map((l) => l.id),
    );
    return loans.map((l) => {
      const terms = {
        principal: Number(l.principal),
        installmentAmount: Number(l.installmentAmount),
        startPeriod: l.startPeriod,
      };
      const paid = repaid.get(l.id) ?? 0;
      return {
        ...l,
        remaining: loanRemainingAfter(terms, period, paid),
        settled: loanIsSettled(terms, period, paid),
      };
    });
  }

  /**
   * CA-1-34: every loan on the books, with the same computed balance the per-employee view
   * shows.
   *
   * `/hr/loans/import` could put five hundred kasbon rows into the ledger in one paste, and
   * no screen listed them — the only way to see a loan was to know whose it was. A
   * bulk-import wizard with no list is a one-way door.
   *
   * The balance is what payroll REALLY deducted (CA-1-05), asked once for the whole page
   * rather than per row, so the list cannot disagree with the employee's own screen.
   */
  async listAll(
    user: AuthenticatedUser,
    query: { page?: number; pageSize?: number; activeOnly?: boolean; asOfPeriod?: string },
  ): Promise<{ rows: LoanListView[]; total: number }> {
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const period = PERIOD_RE.test(query.asOfPeriod ?? '')
      ? query.asOfPeriod!
      : localMonthKey(new Date(), this.config.timeZone);

    const { rows, total } = await this.repo.listAll({
      depotIds: depotScopeIds(user),
      activeOnly: query.activeOnly,
      skip: (page - 1) * take,
      take,
    });
    if (rows.length === 0) return { rows: [], total };

    // One repayment read for the page, keyed by loan — not one per row.
    const repaid = await this.payrolls.deductedBySourceRefBefore(
      null,
      nextPeriod(period),
      rows.map((l) => l.id),
    );
    return {
      rows: rows.map((l) => {
        const terms = {
          principal: Number(l.principal),
          installmentAmount: Number(l.installmentAmount),
          startPeriod: l.startPeriod,
        };
        const paid = repaid.get(l.id) ?? 0;
        return {
          ...l,
          remaining: loanRemainingAfter(terms, period, paid),
          settled: loanIsSettled(terms, period, paid),
        };
      }),
      total,
    };
  }

  /**
   * Scheduled-report table: who still owes kasbon, one row per employee, as of the end of
   * the window. Same ledger as the screens (CA-1-05) — the balance is what payroll really
   * deducted, not what the calendar says it should have.
   *
   * Name and staff code only: the file is mailed as an attachment, so it carries no phone,
   * ID or bank detail. Depot and department are left out on purpose — the depot lives in
   * depot-service and a name column would need a cross-service read per row.
   */
  async reportTable(to: Date): Promise<LoanReportTable> {
    // `to` is the exclusive end of the window, so the month it covers is the instant before.
    const period = localMonthKey(new Date(to.getTime() - 1), this.config.timeZone);
    // One extra row says "there was more" without a count query.
    const { rows: loans } = await this.repo.listAll({
      activeOnly: true,
      skip: 0,
      take: REPORT_ROW_CAP + 1,
    });
    const loanCut = loans.length > REPORT_ROW_CAP;
    const kept = loans.slice(0, REPORT_ROW_CAP);
    const repaid = await this.payrolls.deductedBySourceRefBefore(
      null,
      nextPeriod(period),
      kept.map((l) => l.id),
    );

    const byEmployee = new Map<string, ReportAgg>();
    for (const l of kept) {
      const terms = {
        principal: Number(l.principal),
        installmentAmount: Number(l.installmentAmount),
        startPeriod: l.startPeriod,
      };
      const paid = repaid.get(l.id) ?? 0;
      if (loanIsSettled(terms, period, paid)) continue;
      const agg = byEmployee.get(l.employeeId) ?? {
        name: l.employeeName ?? '—',
        code: l.employeeCode ?? '',
        loans: 0,
        principal: 0,
        repaid: 0,
        remaining: 0,
        installment: 0,
        oldest: l.createdAt,
      };
      agg.loans += 1;
      agg.principal += terms.principal;
      agg.repaid += Math.min(terms.principal, paid);
      agg.remaining += loanRemainingAfter(terms, period, paid);
      agg.installment += terms.installmentAmount;
      if (l.createdAt < agg.oldest) agg.oldest = l.createdAt;
      byEmployee.set(l.employeeId, agg);
    }

    const all = [...byEmployee.values()].sort((a, b) => b.remaining - a.remaining);
    return {
      columns: [
        { key: 'employee', label: 'Karyawan', type: 'text' },
        { key: 'code', label: 'Kode staf', type: 'text' },
        { key: 'loans', label: 'Kasbon aktif', type: 'int' },
        { key: 'principal', label: 'Pokok', type: 'money' },
        { key: 'repaid', label: 'Sudah dibayar', type: 'money' },
        { key: 'remaining', label: 'Sisa saldo', type: 'money' },
        { key: 'installment', label: 'Cicilan per bulan', type: 'money' },
        { key: 'oldest', label: 'Kasbon tertua', type: 'date' },
      ],
      rows: all
        .slice(0, REPORT_ROW_CAP)
        .map((a) => [
          a.name,
          a.code,
          a.loans,
          Math.round(a.principal),
          Math.round(a.repaid),
          Math.round(a.remaining),
          Math.round(a.installment),
          localDayKey(a.oldest, this.config.timeZone),
        ]),
      truncated: loanCut || all.length > REPORT_ROW_CAP,
    };
  }
}
