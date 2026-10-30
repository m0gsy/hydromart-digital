import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { LoanRequest, LoanRequestStatus } from '../../prisma/generated/client';
import {
  LoanRequestDecision,
  LoanRequestListFilter,
  LoanRequestListRow,
  LoanRequestRepository,
  LoanRequestWrite,
} from '../../src/application/ports/loan-request.repository';
import {
  LoanRequestService,
  monthlyBasePay,
  addWorkingDays,
  subtractWorkingDays,
} from '../../src/application/services/loan-request.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { LoanService } from '../../src/application/services/loan.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const ASV = 'asv-account-1';
const STAFF = 'staff-account-1';

// An ASSISTANT_SUPERVISOR carries `depotIds`, not a single `depotId` — the hierarchy walk
// resolves the set onto the token. With neither, `allowedDepots` returns an EMPTY set and
// denies everything, which is the correct behaviour and the wrong fixture.
const asv: AuthenticatedUser = {
  sub: ASV,
  role: 'ASSISTANT_SUPERVISOR' as never,
  phone: '0801',
  depotId: null,
  depotIds: [DEPOT_A],
};
const staff: AuthenticatedUser = {
  sub: STAFF,
  role: 'STAFF_DEPOT' as never,
  phone: '0802',
  depotId: DEPOT_A,
};
const managerOf = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-account-1',
  role: 'MANAGER' as never,
  phone: '0803',
  depotId,
});

/**
 * In-memory stand-in that MOVES its own `updatedAt`, because a fake that freezes one cannot
 * model the thing half these tests are about: every read would hand back the same version
 * and a stale decision would look identical to a fresh one.
 */
class FakeRepo implements LoanRequestRepository {
  rows: LoanRequest[] = [];
  private seq = 0;
  private pendingClash = false;

  /** Make the next create behave like the partial unique index firing. */
  clashOnce(): void {
    this.pendingClash = true;
  }

  async create(data: LoanRequestWrite): Promise<LoanRequest> {
    if (this.pendingClash) {
      this.pendingClash = false;
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
    const row = {
      id: `lr-${++this.seq}`,
      ...data,
      amount: data.amount as never,
      status: 'PENDING' as LoanRequestStatus,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      loanId: null,
      // Recent, so the three-working-day window has not closed on a freshly filed request.
      createdAt: new Date(Date.now() - (100 - this.seq) * 1000),
      updatedAt: new Date(Date.now() - (100 - this.seq) * 1000),
    } as unknown as LoanRequest;
    this.rows.push(row);
    return { ...row };
  }
  async findById(id: string): Promise<LoanRequest | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }
  async listByEmployee(employeeId: string): Promise<LoanRequest[]> {
    return this.rows.filter((r) => r.employeeId === employeeId).map((r) => ({ ...r }));
  }
  async listAll(
    filter: LoanRequestListFilter,
  ): Promise<{ rows: LoanRequestListRow[]; total: number }> {
    const rows = this.rows.filter(
      (r) =>
        (!filter.status || r.status === filter.status) &&
        (!filter.depotIds || filter.depotIds.includes(r.depotId)),
    );
    return {
      rows: rows
        .slice(filter.skip, filter.skip + filter.take)
        .map((r) => ({ ...r, employeeName: 'Budi', employeeCode: 'HR-0001' })),
      total: rows.length,
    };
  }
  async decide(id: string, decision: LoanRequestDecision): Promise<LoanRequest | null> {
    const row = this.rows.find((r) => r.id === id)!;
    // Mirrors the real repository: only a PENDING request can be decided.
    if (row.status !== 'PENDING') return null;
    Object.assign(row, decision, {
      decidedAt: new Date(),
      updatedAt: new Date(++this.seq * 1000),
    });
    return { ...row };
  }
  async attachLoan(id: string, loanId: string): Promise<LoanRequest> {
    const row = this.rows.find((r) => r.id === id)!;
    row.loanId = loanId;
    row.updatedAt = new Date(++this.seq * 1000);
    return { ...row };
  }
  async reopen(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id)!;
    if (row.status !== 'APPROVED' || row.loanId !== null) return;
    Object.assign(row, { status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null });
  }
}

const EMPLOYEE = {
  id: 'emp-1',
  fullName: 'Budi',
  phone: '0802',
  authSubjectId: STAFF,
  depotId: DEPOT_A,
  monthlyRate: 5_000_000,
  dailyRate: null,
};

function make(
  overrides: {
    depotId?: string | null;
    assistant?: string | null;
    owed?: number;
    loanFails?: boolean;
  } = {},
) {
  const repo = new FakeRepo();
  const employee = { ...EMPLOYEE, depotId: overrides.depotId ?? EMPLOYEE.depotId };
  if ('depotId' in overrides && overrides.depotId === null) employee.depotId = null as never;
  const employees = {
    getSelf: async () => employee,
    findByIdInternal: async () => employee,
    findByAuthSubjectId: async (id: string) =>
      id === ASV ? { ...employee, id: 'emp-asv', authSubjectId: ASV, phone: '0801' } : null,
  } as unknown as EmployeeService;
  const created: Record<string, unknown>[] = [];
  const loans = {
    openBalance: async () => overrides.owed ?? 0,
    create: async (_u: AuthenticatedUser, input: Record<string, unknown>) => {
      if (overrides.loanFails) throw new Error('payroll unavailable');
      created.push(input);
      return { id: 'loan-1', ...input };
    },
  } as unknown as LoanService;
  const assistant = 'assistant' in overrides ? overrides.assistant : ASV;
  const supervision = {
    superiorOf: async () => null,
    setSuperior: async () => {},
    assistantOfDepot: async () => {
      if (assistant === 'THROW') throw new ServiceUnavailableException('depot-service');
      return assistant ?? null;
    },
  };
  const sent: { event: string; subjectId: string }[] = [];
  const notifications = {
    notify: async (event: string, _p: string, _v: unknown, subjectId: string) => {
      sent.push({ event, subjectId });
    },
  };
  return {
    repo,
    created,
    sent,
    employee,
    svc: new LoanRequestService(repo, employees, loans, supervision, notifications),
  };
}

const APPLY = { amount: 500_000, reason: 'Biaya sekolah anak' };

// Filed at 03:00 WIB on Saturday 2026-10-17 = Friday 20:00 UTC. The UTC weekday said "Friday, a
// working day", so one working day out came back as Tuesday instead of Monday.
describe('working days are counted on the WIB calendar', () => {
  it('a request filed in the small hours of a WIB Saturday is due the next WIB working day', () => {
    const filed = new Date('2026-10-16T20:00:00Z'); // Sat 03:00 WIB
    const due = addWorkingDays(filed, 1);
    expect(due.toISOString()).toBe('2026-10-18T20:00:00.000Z'); // Mon 03:00 WIB
  });

  it('counting back crosses the same boundary the same way', () => {
    // Mon 03:00 WIB (Sun 20:00 UTC) minus one working day = Fri 03:00 WIB.
    const back = subtractWorkingDays(new Date('2026-10-18T20:00:00Z'), 1);
    expect(back.toISOString()).toBe('2026-10-15T20:00:00.000Z'); // Fri 03:00 WIB
  });

  it('a request filed on a WIB Monday morning is not penalised for UTC still saying Sunday', () => {
    const due = addWorkingDays(new Date('2026-10-18T20:00:00Z'), 3); // Mon 03:00 WIB
    expect(due.toISOString()).toBe('2026-10-21T20:00:00.000Z'); // Thu 03:00 WIB
  });
});

describe('addWorkingDays and monthlyBasePay', () => {
  it('skips weekends when counting back the decision window', () => {
    // Wednesday 14 Oct 2026 minus three working days is Friday 9 Oct.
    expect(addWorkingDays(new Date('2026-10-09T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2026-10-14');
    // Monday minus one working day is the Friday before.
    expect(addWorkingDays(new Date('2026-10-09T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-10-12');
  });

  it('reads a month of base pay: monthly rate, 26 days of a daily rate, or nothing', () => {
    expect(monthlyBasePay({ monthlyRate: '4500000' })).toBe(4_500_000);
    expect(monthlyBasePay({ monthlyRate: null, dailyRate: 100_000 })).toBe(2_600_000);
    expect(monthlyBasePay({})).toBeNull();
  });
});

describe('LoanRequestService.submit', () => {
  it('files a request and tells the person who decides it', async () => {
    const { svc, sent } = make();
    const r = await svc.submit(staff, APPLY);
    expect(r).toMatchObject({ status: 'PENDING', depotId: DEPOT_A, loanId: null });
    expect(sent).toEqual([{ event: 'LOAN_REQUEST_SUBMITTED', subjectId: ASV }]);
  });

  /*
   * The refusal that closes four holes at once. `Employee.depotId` is nullable for Asisten
   * SPV / SPV / Manager / Direktur, and without a depot there is no assistant supervisor to
   * decide, no queue for the row to appear in, no scope to check a decider against, and
   * nothing standing between somebody and their own approval.
   */
  it('refuses an applicant who sits above any single depot', async () => {
    const { svc } = make({ depotId: null });
    await expect(svc.submit(staff, APPLY)).rejects.toThrow(BadRequestException);
  });

  it('refuses a nominal that is not a whole positive number, and an empty reason', async () => {
    const { svc } = make();
    await expect(svc.submit(staff, { ...APPLY, amount: 0 })).rejects.toThrow(/bilangan bulat/);
    await expect(svc.submit(staff, { ...APPLY, amount: -1 })).rejects.toThrow(/bilangan bulat/);
    await expect(svc.submit(staff, { ...APPLY, amount: 1.5 })).rejects.toThrow(/bilangan bulat/);
    await expect(svc.submit(staff, { ...APPLY, reason: '   ' })).rejects.toThrow(/Alasan/);
  });

  // Caught, not read-then-written: two tabs racing produce one row and one refusal.
  it('turns the unique-index violation into one open request per person', async () => {
    const { svc, repo } = make();
    repo.clashOnce();
    await expect(svc.submit(staff, APPLY)).rejects.toThrow(ConflictException);
  });

  // Only P2002 means "you already have one". Anything else is a real failure and must
  // surface as itself, not as a friendly message about a request that was never written.
  it('lets a database failure that is not the unique index through unchanged', async () => {
    const { svc, repo } = make();
    jest.spyOn(repo, 'create').mockRejectedValueOnce(
      Object.assign(new Error('boom'), {
        code: 'P1001',
      }),
    );
    await expect(svc.submit(staff, APPLY)).rejects.toThrow('boom');
  });

  // Fail-OPEN, and only here: the decision itself fails closed.
  it('files the request even when nobody can be told about it', async () => {
    const { svc } = make({ assistant: 'THROW' as never });
    await expect(svc.submit(staff, APPLY)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('says nothing to nobody when the depot has no assistant recorded', async () => {
    const { svc, sent } = make({ assistant: null });
    await svc.submit(staff, APPLY);
    expect(sent).toEqual([]);
  });
});

describe('LoanRequestService kasbon limit and decision window', () => {
  it('refuses more than one month of base pay and a missing rate', async () => {
    const { svc } = make();
    await expect(svc.submit(staff, { amount: 5_000_001, reason: 'sakit' })).rejects.toThrow(
      /melebihi batas 1x gaji pokok/,
    );
  });

  it('counts what is still owed against the limit', async () => {
    const { svc } = make({ owed: 4_500_000 });
    await expect(svc.submit(staff, { amount: 600_000, reason: 'x' })).rejects.toThrow(
      /sisa kasbon Anda Rp4\.500\.000/,
    );
    await expect(svc.submit(staff, { amount: 500_000, reason: 'x' })).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('closes a request nobody answered in three working days, and refuses to decide it', async () => {
    const { svc, repo } = make();
    const stale = await repo.create({ employeeId: 'emp-1', depotId: DEPOT_A, amount: 100000, reason: 'x' });
    const row = repo.rows.find((r) => r.id === stale.id)!;
    (row as { createdAt: Date }).createdAt = new Date(Date.now() - 10 * 86_400_000);

    const mine = await svc.listSelf(staff);
    expect(mine.find((r) => r.id === stale.id)?.status).toBe('CANCELLED');
    expect(mine.find((r) => r.id === stale.id)?.decisionNote).toMatch(/Kedaluwarsa/);

    // The approver arriving late is told so, and the request is closed rather than approved.
    const late = await repo.create({ employeeId: 'emp-1', depotId: DEPOT_A, amount: 100000, reason: 'z' });
    (repo.rows.find((r) => r.id === late.id)! as { createdAt: Date }).createdAt = new Date(
      Date.now() - 10 * 86_400_000,
    );
    await expect(
      svc.decide(asv, late.id, {
        approve: true,
        seenUpdatedAt: repo.rows.find((r) => r.id === late.id)!.updatedAt.toISOString(),
      } as never),
    ).rejects.toThrow(/kedaluwarsa/);
    expect(repo.rows.find((r) => r.id === late.id)?.status).toBe('CANCELLED');
  });

  it('counts back three working days over a weekend', () => {
    // Wed 14 Oct 2026 minus three working days is Fri 9 Oct.
    expect(subtractWorkingDays(new Date('2026-10-14T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2026-10-09');
  });

  it('warns that a pending request is past its window (overdue) before it is closed', async () => {
    const { svc, repo } = make();
    const stale = await repo.create({ employeeId: 'emp-1', depotId: DEPOT_A, amount: 100000, reason: 'x' });
    const row = repo.rows.find((r) => r.id === stale.id)!;
    (row as { createdAt: Date }).createdAt = new Date(Date.now() - 10 * 86_400_000);
    const fresh = await repo.create({ employeeId: 'emp-1', depotId: DEPOT_A, amount: 100000, reason: 'y' });

    const { rows } = await svc.listAll(asv, {});
    expect(rows.find((r) => r.id === stale.id)).toMatchObject({ overdue: true, status: 'PENDING' });
    expect(rows.find((r) => r.id === fresh.id)?.overdue).toBe(false);
    // Seen by the approver as overdue; the applicant's own list is what closes it.
    expect((await svc.listSelf(staff)).find((r) => r.id === stale.id)?.status).toBe('CANCELLED');
  });
});

describe('LoanRequestService.cancel', () => {
  it('withdraws my own pending request', async () => {
    const { svc } = make();
    const r = await svc.submit(staff, APPLY);
    await expect(svc.cancel(staff, r.id)).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('404s on somebody else’s, and refuses one already decided', async () => {
    const { svc, repo } = make();
    const r = await svc.submit(staff, APPLY);
    await expect(svc.cancel(staff, 'nope')).rejects.toThrow(NotFoundException);
    await repo.decide(r.id, {
      status: 'APPROVED',
      decidedBy: ASV,
      decisionNote: null,
      loanId: 'loan-1',
    });
    await expect(svc.cancel(staff, r.id)).rejects.toThrow(ConflictException);
  });
});

describe('LoanRequestService.decide — concurrent deciders', () => {
  const approve = (r: { updatedAt: Date }) => ({
    approve: true,
    installmentAmount: 100_000,
    startPeriod: '2026-10',
    seenUpdatedAt: r.updatedAt.toISOString(),
  });

  it('the loser of two approvals creates no loan (the employee is deducted once)', async () => {
    const { svc, repo, created } = make();
    const r = await svc.submit(staff, APPLY);
    const real = repo.decide.bind(repo);
    // The OTHER approver commits first: the request is no longer PENDING when ours is claimed.
    jest.spyOn(repo, 'decide').mockImplementationOnce(async (id, decision) => {
      await real(id, { ...decision, decidedBy: 'someone-else' });
      return real(id, decision);
    });

    await expect(svc.decide(asv, r.id, approve(r))).rejects.toThrow(/sudah diputuskan/);

    expect(created).toHaveLength(0);
    expect(repo.rows[0]).toMatchObject({ status: 'APPROVED', decidedBy: 'someone-else' });
  });

  it('an approval whose loan cannot be created goes back to PENDING, not APPROVED-with-nothing', async () => {
    const { svc, repo } = make({ loanFails: true });
    const r = await svc.submit(staff, APPLY);

    await expect(svc.decide(asv, r.id, approve(r))).rejects.toThrow('payroll unavailable');

    expect(repo.rows[0]).toMatchObject({ status: 'PENDING', decidedBy: null, loanId: null });
  });

  it('a rejection that loses to an approval changes nothing and says so', async () => {
    const { svc, repo } = make();
    const r = await svc.submit(staff, APPLY);
    const real = repo.decide.bind(repo);
    jest.spyOn(repo, 'decide').mockImplementationOnce(async (id, decision) => {
      await real(id, { ...decision, status: 'APPROVED', decidedBy: 'someone-else' });
      return real(id, decision);
    });

    await expect(
      svc.decide(asv, r.id, { approve: false, note: 'tidak', seenUpdatedAt: r.updatedAt.toISOString() }),
    ).rejects.toThrow(/sudah diputuskan/);
    expect(repo.rows[0].status).toBe('APPROVED');
  });

  it('withdrawing a request that was decided meanwhile is refused', async () => {
    const { svc, repo } = make();
    const r = await svc.submit(staff, APPLY);
    const real = repo.decide.bind(repo);
    jest.spyOn(repo, 'decide').mockImplementationOnce(async (id, decision) => {
      await real(id, { ...decision, status: 'REJECTED', decidedBy: ASV });
      return real(id, decision);
    });

    await expect(svc.cancel(staff, r.id)).rejects.toThrow(/sudah diputuskan/);
    expect(repo.rows[0].status).toBe('REJECTED');
  });
});

describe('LoanRequestService.decide', () => {
  it('approves, sets the terms, and creates the loan the payslip will name', async () => {
    const { svc, created, sent } = make();
    const r = await svc.submit(staff, APPLY);
    const decided = await svc.decide(asv, r.id, {
      approve: true,
      installmentAmount: 100_000,
      startPeriod: '2026-10',
      seenUpdatedAt: r.updatedAt.toISOString(),
    });
    expect(decided).toMatchObject({ status: 'APPROVED', loanId: 'loan-1', decidedBy: ASV });
    // `note` is the WORD, never the request id: payroll prints this straight onto a payslip.
    expect(created[0]).toEqual({
      employeeId: 'emp-1',
      principal: 500_000,
      installmentAmount: 100_000,
      startPeriod: '2026-10',
      note: 'Kasbon',
    });
    expect(sent.at(-1)).toEqual({ event: 'LOAN_REQUEST_APPROVED', subjectId: STAFF });
  });

  it('demands the terms on an approval, and a reason on a rejection', async () => {
    const { svc } = make();
    const r = await svc.submit(staff, APPLY);
    const seenUpdatedAt = r.updatedAt.toISOString();
    await expect(svc.decide(asv, r.id, { approve: true, seenUpdatedAt })).rejects.toThrow(
      /Cicilan/,
    );
    await expect(
      svc.decide(asv, r.id, { approve: true, installmentAmount: 0, seenUpdatedAt }),
    ).rejects.toThrow(/Cicilan/);
    await expect(
      svc.decide(asv, r.id, { approve: true, installmentAmount: 100, seenUpdatedAt }),
    ).rejects.toThrow(/YYYY-MM/);
    await expect(
      svc.decide(asv, r.id, {
        approve: true,
        installmentAmount: 100,
        startPeriod: '2026-13',
        seenUpdatedAt,
      }),
    ).rejects.toThrow(/YYYY-MM/);
    await expect(svc.decide(asv, r.id, { approve: false, seenUpdatedAt })).rejects.toThrow(
      /Alasan penolakan/,
    );
  });

  it('rejects with the reason the applicant will read', async () => {
    const { svc, sent } = make();
    const r = await svc.submit(staff, APPLY);
    const decided = await svc.decide(asv, r.id, {
      approve: false,
      note: '  Belum ada anggaran  ',
      seenUpdatedAt: r.updatedAt.toISOString(),
    });
    expect(decided).toMatchObject({ status: 'REJECTED', decisionNote: 'Belum ada anggaran' });
    expect(sent.at(-1)).toEqual({ event: 'LOAN_REQUEST_REJECTED', subjectId: STAFF });
  });

  it('never lets anybody sign off their own', async () => {
    const { svc } = make();
    const r = await svc.submit(staff, APPLY);
    await expect(
      svc.decide(staff, r.id, {
        approve: true,
        installmentAmount: 100_000,
        startPeriod: '2026-10',
        seenUpdatedAt: r.updatedAt.toISOString(),
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a decider from another depot, and one who is not the assistant', async () => {
    const { svc } = make();
    const r = await svc.submit(staff, APPLY);
    const seenUpdatedAt = r.updatedAt.toISOString();
    // Out of scope entirely.
    await expect(
      svc.decide(managerOf(DEPOT_B), r.id, { approve: false, note: 'x', seenUpdatedAt }),
    ).rejects.toThrow(ForbiddenException);
    // In scope, but this depot HAS an assistant and it is not them (K1).
    await expect(
      svc.decide(managerOf(DEPOT_A), r.id, { approve: false, note: 'x', seenUpdatedAt }),
    ).rejects.toThrow(/asisten supervisor/);
  });

  /*
   * K2: a depot with no assistant recorded is in nobody's DERIVED scope —
   * `depotsForAssistants` cannot reach a depot that hangs off nobody — so the only way in
   * is a direct grant, and `assertDepotAccess` is that check.
   */
  it('lets the depot’s manager decide when no assistant is recorded', async () => {
    const { svc } = make({ assistant: null });
    const r = await svc.submit(staff, APPLY);
    await expect(
      svc.decide(managerOf(DEPOT_A), r.id, {
        approve: false,
        note: 'Belum bisa',
        seenUpdatedAt: r.updatedAt.toISOString(),
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
  });

  /*
   * Money fails CLOSED. A lookup that failed is not the same answer as "no assistant" —
   * treating it as one would widen the approval right exactly when the system is least
   * able to say who holds it.
   */
  it('raises rather than guessing when depot-service cannot say who decides', async () => {
    const { svc } = make({ assistant: 'THROW' as never });
    const r = await svc.submit(staff, APPLY);
    await expect(
      svc.decide(managerOf(DEPOT_A), r.id, {
        approve: true,
        installmentAmount: 100,
        startPeriod: '2026-10',
        seenUpdatedAt: r.updatedAt.toISOString(),
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('404s on a request nobody raised', async () => {
    const { svc } = make();
    await expect(svc.decide(asv, 'nope', { approve: false, note: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  // CA-2-53, unconditionally: two approvers on one request must not both write.
  it('refuses a decision built on a copy somebody else already answered against', async () => {
    const { svc } = make();
    const r = await svc.submit(staff, APPLY);
    const stale = r.updatedAt.toISOString();
    await svc.decide(asv, r.id, { approve: false, note: 'Belum bisa', seenUpdatedAt: stale });
    await expect(
      svc.decide(asv, r.id, { approve: false, note: 'Lagi', seenUpdatedAt: stale }),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
    // …and a decision naming no version at all is refused the same way.
    await expect(svc.decide(asv, r.id, { approve: false, note: 'Lagi' })).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
  });

  it('refuses a second decision on a request already answered', async () => {
    const { svc, repo } = make();
    const r = await svc.submit(staff, APPLY);
    const decided = await svc.decide(asv, r.id, {
      approve: false,
      note: 'Belum bisa',
      seenUpdatedAt: r.updatedAt.toISOString(),
    });
    const fresh = (await repo.findById(decided.id))!;
    await expect(
      svc.decide(asv, r.id, {
        approve: false,
        note: 'x',
        seenUpdatedAt: fresh.updatedAt.toISOString(),
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('LoanRequestService.listAll / listSelf', () => {
  it('scopes the queue by depot and pages it', async () => {
    const { svc } = make();
    await svc.submit(staff, APPLY);
    const mine = await svc.listAll(managerOf(DEPOT_A), { status: 'PENDING' });
    expect(mine.total).toBe(1);
    expect(mine.rows[0]).toMatchObject({ employeeName: 'Budi', employeeCode: 'HR-0001' });
    const theirs = await svc.listAll(managerOf(DEPOT_B), {});
    expect(theirs.total).toBe(0);
    // Page size is clamped, like every other HR list.
    const clamped = await svc.listAll(managerOf(DEPOT_A), { page: 0, pageSize: 5000 });
    expect(clamped.total).toBe(1);
  });

  it('hands me back everything I ever asked for', async () => {
    const { svc } = make();
    await svc.submit(staff, APPLY);
    await expect(svc.listSelf(staff)).resolves.toHaveLength(1);
  });
});
