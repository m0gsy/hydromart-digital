import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  assertDepotAccess,
  assertFresh,
  depotScopeIds,
  localDayKey,
} from '@hydromart/platform';

import { Loan, LoanRequest } from '../../../prisma/generated/client';
import {
  LOAN_REQUEST_REPOSITORY,
  LoanRequestListRow,
  LoanRequestRepository,
} from '../ports/loan-request.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../ports/notification.port';
import { SUPERVISION_PORT, SupervisionPort } from '../ports/supervision.port';
import { EmployeeService } from './employee.service';
import { LoanService } from './loan.service';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A queue row plus who it belongs to. */
export type LoanRequestView = LoanRequestListRow & {
  /** createdAt + 3 working days. Derived, so no column and no migration. */
  dueAt: Date;
  /**
   * PENDING past `dueAt`: the window is over. The request is closed as 'Kedaluwarsa' the next
   * time anybody touches it (the applicant's list, a new request, a decision attempt), so this
   * is the approver's last warning, not a state that lasts.
   */
  overdue: boolean;
};

export interface DecideLoanRequestInput {
  approve: boolean;
  note?: string;
  /** Set by the APPROVER, never by the applicant (K3). Required on an approval. */
  installmentAmount?: number;
  startPeriod?: string;
  seenUpdatedAt?: string;
}

/** Owner decision 2026-10-14: a kasbon request is decided within three working days. */
const DECISION_WINDOW_WORKING_DAYS = 3;

/**
 * Whether the instant falls on a Saturday or Sunday on the BUSINESS (WIB) calendar.
 *
 * Judged on the WIB day, not the UTC one: a request filed at 03:00 WIB on Saturday is still Friday
 * in UTC, so the UTC weekday called it a working day and the answer was due a day late. The
 * payment-service refund promise had the same defect and was fixed the same way.
 */
function isWeekendWib(at: Date): boolean {
  // tz-ok: the key is a WIB calendar date, parsed at UTC midnight only to read its weekday.
  const dow = new Date(`${localDayKey(at)}T00:00:00.000Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** `from` minus `n` Mon-Fri days (public holidays are not modelled — a week-end is the floor). */
export function subtractWorkingDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekendWib(d)) left -= 1;
  }
  return d;
}

/** `from` plus `n` Mon-Fri days: when a request filed at `from` is due to be answered. */
export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekendWib(d)) left -= 1;
  }
  return d;
}

/** One month of base pay in IDR; a DAILY employee's month is 26 paid days. Null = no rate on file. */
export function monthlyBasePay(e: { monthlyRate?: unknown; dailyRate?: unknown }): number | null {
  const monthly = e.monthlyRate == null ? 0 : Number(e.monthlyRate);
  if (monthly > 0) return monthly;
  const daily = e.dailyRate == null ? 0 : Number(e.dailyRate);
  return daily > 0 ? daily * 26 : null;
}

/**
 * Kasbon an employee raises for themselves.
 *
 * The shape copies `LeaveRequest`: the request is its own row and the APPROVAL is what
 * makes it real. `Loan` is untouched — not one column — because every one of its rows is
 * money payroll is already deducting, and `domain/loan.ts` reads `startPeriod` before its
 * own guards: `installmentsElapsed` calls `periodIndex(loan.startPeriod).split('-')` at
 * line 34, ahead of the guard on line 35, and `loanRemainingAfter` / `loanIsSettled` have
 * no guard at all. One PENDING row with no start period would make `GET /loans/all` throw
 * 500 for everybody.
 *
 * WHO DECIDES (K1/K2): the assistant supervisor of the depot the request was raised at.
 * When that depot has none recorded, anyone whose depot scope already reaches it may
 * decide — in practice a manager holding a direct grant, because `depotsForAssistants`
 * cannot derive a depot that hangs off nobody into anyone's scope. That is also why
 * `cancel` exists: it is the applicant's way out of a request nobody can answer, not a
 * convenience.
 */
@Injectable()
export class LoanRequestService {
  private readonly logger = new Logger(LoanRequestService.name);

  constructor(
    @Inject(LOAN_REQUEST_REPOSITORY) private readonly repo: LoanRequestRepository,
    private readonly employees: EmployeeService,
    private readonly loans: LoanService,
    @Inject(SUPERVISION_PORT) private readonly supervision: SupervisionPort,
    @Inject(NOTIFICATION_PORT) private readonly notifications: NotificationPort,
  ) {}

  /**
   * Raise one for myself. The applicant names an amount and a reason and nothing else —
   * the instalment and the month it starts are the approver's to set (K3), because those
   * are the terms of a debt and not a wish.
   */
  async submit(
    user: AuthenticatedUser,
    input: { amount: number; reason: string },
  ): Promise<LoanRequest> {
    const employee = await this.employees.getSelf(user);
    /*
     * REFUSED when the employee sits above a single depot, and this one refusal closes four
     * holes at once. `Employee.depotId` is nullable and the schema says so out loud for
     * Asisten SPV / SPV / Manager / Direktur. Without a depot there is no assistant
     * supervisor to decide, no queue for the row to appear in, no depot scope to check a
     * decider against, and nothing standing between somebody and their own approval.
     * Filing it nowhere would be worse than saying no.
     */
    if (!employee.depotId) {
      throw new BadRequestException(
        'Kasbon diputuskan oleh asisten supervisor depot, dan akun ini tidak terikat pada satu depot. Ajukan lewat HR.',
      );
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException('Nominal kasbon harus bilangan bulat lebih dari 0');
    }
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Alasan kasbon wajib diisi');

    /*
     * Owner decision 2026-10-14: a kasbon may not exceed one month of base pay. A DAILY
     * employee's month is 26 paid days. With no rate recorded there is nothing to measure
     * against, and "no limit" would be the wrong default for money — so it is refused with a
     * pointer to HR rather than waved through.
     */
    const cap = monthlyBasePay(employee);
    if (cap === null) {
      throw new BadRequestException(
        'Gaji pokok Anda belum diisi sehingga batas kasbon tidak bisa dihitung. Hubungi HR.',
      );
    }
    // Owner decision 2026-10-16: the limit is on the OPEN balance, not on one request —
    // what is still owed plus this ask may not pass one month of base pay.
    const owed = await this.loans.openBalance(employee.id);
    if (owed + input.amount > cap) {
      throw new BadRequestException(
        `Kasbon melebihi batas 1x gaji pokok (Rp${cap.toLocaleString('id-ID')}); sisa kasbon Anda Rp${owed.toLocaleString('id-ID')}.`,
      );
    }

    // An open request nobody answered within the window is closed first, so the person is
    // not stuck behind a decision that is no longer coming.
    await this.expireStaleFor(employee.id, user.sub);

    let request: LoanRequest;
    try {
      request = await this.repo.create({
        employeeId: employee.id,
        depotId: employee.depotId,
        amount: input.amount,
        reason,
      });
    } catch (err) {
      // P2002 on the partial unique index: they already have one open. Caught rather than
      // read-then-write, so two tabs racing produce one row and one refusal.
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Masih ada pengajuan kasbon yang belum diputuskan.');
      }
      throw err;
    }
    await this.notifyDecider(employee.depotId, employee.fullName, input.amount);
    return request;
  }

  /** Everything I ever asked for, newest first. */
  async listSelf(user: AuthenticatedUser): Promise<LoanRequest[]> {
    const employee = await this.employees.getSelf(user);
    await this.expireStaleFor(employee.id, user.sub);
    return this.repo.listByEmployee(employee.id);
  }

  /**
   * Close this person's PENDING requests that outlived the decision window. They become
   * CANCELLED with a note saying why, so the applicant reads "kedaluwarsa" rather than a
   * request that is silently still open. Lazy on purpose: no sweep job, and the answer is
   * the same whenever somebody next looks.
   */
  private async expireStaleFor(employeeId: string, actorId: string): Promise<void> {
    const cutoff = subtractWorkingDays(new Date(), DECISION_WINDOW_WORKING_DAYS);
    const rows = await this.repo.listByEmployee(employeeId);
    for (const r of rows) {
      if (r.status === 'PENDING' && r.createdAt < cutoff) {
        await this.repo.decide(r.id, {
          status: 'CANCELLED',
          decidedBy: actorId,
          decisionNote: `Kedaluwarsa: tidak diputuskan dalam ${DECISION_WINDOW_WORKING_DAYS} hari kerja.`,
          loanId: null,
        });
      }
    }
  }

  /** Withdraw my own request while nobody has answered it. */
  async cancel(user: AuthenticatedUser, id: string): Promise<LoanRequest> {
    const employee = await this.employees.getSelf(user);
    const request = await this.repo.findById(id);
    if (!request || request.employeeId !== employee.id) {
      throw new NotFoundException('Pengajuan kasbon tidak ditemukan');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('Pengajuan ini sudah diputuskan.');
    }
    const cancelled = await this.repo.decide(id, {
      status: 'CANCELLED',
      decidedBy: user.sub,
      decisionNote: null,
      loanId: null,
    });
    // Lost to a decision that landed first (the write is guarded on PENDING).
    if (!cancelled) throw new ConflictException('Pengajuan ini sudah diputuskan.');
    return cancelled;
  }

  /** The decision queue, depot-scoped and paged like every other HR list. */
  async listAll(
    user: AuthenticatedUser,
    query: { page?: number; pageSize?: number; status?: string },
  ): Promise<{ rows: LoanRequestView[]; total: number }> {
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const { rows, total } = await this.repo.listAll({
      depotIds: depotScopeIds(user),
      status: query.status as never,
      skip: (page - 1) * take,
      take,
    });
    const now = new Date();
    return {
      rows: rows.map((r) => {
        const dueAt = addWorkingDays(r.createdAt, DECISION_WINDOW_WORKING_DAYS);
        return { ...r, dueAt, overdue: r.status === 'PENDING' && dueAt < now };
      }),
      total,
    };
  }

  /**
   * Answer one. The order of the checks is the order of the questions, and it is not
   * arbitrary: does it exist, whose is it, may you see this depot at all, are you the
   * person who decides here, is your copy current — and only then, do the terms you typed
   * make sense.
   */
  async decide(
    user: AuthenticatedUser,
    id: string,
    input: DecideLoanRequestInput,
  ): Promise<LoanRequest> {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundException('Pengajuan kasbon tidak ditemukan');
    const employee = await this.employees.findByIdInternal(request.employeeId);
    if (!employee) throw new NotFoundException('Karyawan pengaju tidak ditemukan');
    // Nobody signs off their own money, whatever else they hold.
    if (employee.authSubjectId && employee.authSubjectId === user.sub) {
      throw new ForbiddenException('Kasbon sendiri tidak bisa Anda setujui.');
    }
    assertDepotAccess(user, request.depotId);

    // Throws 503 rather than answering "nobody" when depot-service is unreachable: a failed
    // lookup is not the same answer as no assistant, and the difference here is who is
    // allowed to hand out money. This half fails CLOSED.
    const decider = await this.supervision.assistantOfDepot(request.depotId);
    // K2: a depot with no assistant recorded escalates to whoever's scope already reaches
    // it — a manager holding a direct grant, since the hierarchy walk cannot derive a depot
    // that hangs off nobody. `assertDepotAccess` above IS that check.
    if (decider && decider !== user.sub) {
      throw new ForbiddenException('Kasbon ini diputuskan oleh asisten supervisor depotnya.');
    }

    // Unconditional: a decision is a record somebody read before answering, and two
    // approvers on one request must not both write.
    assertFresh(request.updatedAt, input.seenUpdatedAt);
    if (request.status !== 'PENDING') {
      throw new ConflictException('Pengajuan ini sudah diputuskan.');
    }
    if (request.createdAt < subtractWorkingDays(new Date(), DECISION_WINDOW_WORKING_DAYS)) {
      // The write is guarded on PENDING: if a concurrent approval won, it stands.
      await this.repo.decide(id, {
        status: 'CANCELLED',
        decidedBy: user.sub,
        decisionNote: `Kedaluwarsa: tidak diputuskan dalam ${DECISION_WINDOW_WORKING_DAYS} hari kerja.`,
        loanId: null,
      });
      throw new ConflictException(
        `Pengajuan ini kedaluwarsa (lewat ${DECISION_WINDOW_WORKING_DAYS} hari kerja); pemohon perlu mengajukan lagi.`,
      );
    }

    if (!input.approve) {
      const note = input.note?.trim();
      if (!note) throw new BadRequestException('Alasan penolakan wajib diisi');
      const decided = await this.repo.decide(id, {
        status: 'REJECTED',
        decidedBy: user.sub,
        decisionNote: note,
        loanId: null,
      });
      if (!decided) throw new ConflictException('Pengajuan ini sudah diputuskan.');
      await this.notifyApplicant(
        decided,
        employee.fullName,
        employee.phone,
        employee.authSubjectId,
      );
      return decided;
    }

    const installmentAmount = input.installmentAmount;
    if (!Number.isInteger(installmentAmount) || (installmentAmount as number) <= 0) {
      throw new BadRequestException('Cicilan per bulan harus bilangan bulat lebih dari 0');
    }
    if (!input.startPeriod || !PERIOD_RE.test(input.startPeriod)) {
      throw new BadRequestException('Bulan mulai potong harus format YYYY-MM');
    }

    /*
     * `note` is the word 'Kasbon', never the request id: payroll prints this string
     * straight onto the payslip, so a UUID here becomes a UUID on somebody's payslip. The
     * link back to the request lives on the request, in `loanId`.
     */
    /*
     * Decide FIRST, then create the loan — the same order as payout's approveAndCredit
     * (PYO-4). The loan used to be created before the request was marked, so two approvers
     * on one request both created a loan (the employee was deducted twice) and the second
     * write orphaned the first. The status change now happens only if the request is still
     * PENDING; the loser is told so and creates nothing. A loan that then fails to create
     * puts the request back to PENDING rather than leaving it APPROVED with nothing behind it.
     */
    const claimed = await this.repo.decide(id, {
      status: 'APPROVED',
      decidedBy: user.sub,
      decisionNote: input.note?.trim() || null,
      loanId: null,
    });
    if (!claimed) throw new ConflictException('Pengajuan ini sudah diputuskan.');

    let loan: Loan;
    try {
      loan = await this.loans.create(user, {
        employeeId: request.employeeId,
        principal: Number(request.amount),
        installmentAmount: installmentAmount as number,
        startPeriod: input.startPeriod,
        note: 'Kasbon',
      });
    } catch (error) {
      await this.repo.reopen(id).catch((reopenError) =>
        this.logger.error(
          `Kasbon request ${id} is APPROVED but its loan failed and it could not be reopened: ${(reopenError as Error).message}`,
        ),
      );
      throw error;
    }
    const decided = await this.repo.attachLoan(id, loan.id);
    await this.notifyApplicant(decided, employee.fullName, employee.phone, employee.authSubjectId);
    return decided;
  }

  /*
   * Fail-OPEN, and only here. The notification port never throws (its own doc says so), so
   * a kasbon is never refused because crm-service blinked — the opposite rule to the money
   * path above, which is exactly why the two are written apart rather than shared.
   *
   * The two-hop lookup is not ceremony: `notify` wants a PHONE NUMBER, and every id on this
   * path is an auth account id. The same hop `leave.service.ts` makes to notify a
   * supervisor.
   */
  private async notifyDecider(depotId: string, name: string, amount: number): Promise<void> {
    let deciderAccountId: string | null = null;
    try {
      deciderAccountId = await this.supervision.assistantOfDepot(depotId);
    } catch {
      return; // a notification, not the decision — see above
    }
    if (!deciderAccountId) return;
    const decider = await this.employees.findByAuthSubjectId(deciderAccountId);
    if (!decider?.authSubjectId) return;
    await this.notifications.notify(
      'LOAN_REQUEST_SUBMITTED',
      decider.phone,
      { name, amount: String(amount) },
      decider.authSubjectId,
    );
  }

  private async notifyApplicant(
    request: LoanRequest,
    name: string,
    phone: string,
    authSubjectId: string | null,
  ): Promise<void> {
    if (!authSubjectId) return;
    await this.notifications.notify(
      request.status === 'APPROVED' ? 'LOAN_REQUEST_APPROVED' : 'LOAN_REQUEST_REJECTED',
      phone,
      {
        name,
        amount: String(Number(request.amount)),
        reason: request.decisionNote ?? '-',
      },
      authSubjectId,
    );
  }
}
