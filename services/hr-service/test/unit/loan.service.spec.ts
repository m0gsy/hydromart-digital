import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Loan } from '../../prisma/generated/client';
import { LoanRepository, LoanWrite } from '../../src/application/ports/loan.repository';
import { LoanService } from '../../src/application/services/loan.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements LoanRepository {
  rows: Loan[] = [];
  private seq = 0;
  async create(data: LoanWrite): Promise<Loan> {
    const row = { id: `l-${++this.seq}`, ...data } as unknown as Loan;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Partial<Pick<LoanWrite, 'active' | 'note'>>): Promise<Loan> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findById(id: string): Promise<Loan | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  /*
   * CA-1-34: the network-wide list. Honours `activeOnly` and paging because the service
   * relies on the repository to do both — a fake that returned everything would pass a
   * paging test that the database would fail. Depot scoping lives on the employee join and
   * has no meaning against this in-memory row set, so it is left to the repository test.
   */
  lastListAll?: { activeOnly?: boolean; skip: number; take: number };
  async listAll(filter: { activeOnly?: boolean; skip: number; take: number }) {
    this.lastListAll = filter;
    const rows = this.rows.filter((r) => (filter.activeOnly ? r.active : true));
    return {
      rows: rows
        .slice(filter.skip, filter.skip + filter.take)
        .map((r) => ({ ...r, employeeName: null, employeeCode: null })),
      total: rows.length,
    };
  }
  async listByEmployee(employeeId: string): Promise<Loan[]> {
    return this.rows.filter(
      (r) => (r as unknown as { employeeId: string }).employeeId === employeeId,
    );
  }
  async listActiveByEmployee(employeeId: string): Promise<Loan[]> {
    return this.rows.filter(
      (r) => (r as unknown as { employeeId: string }).employeeId === employeeId && r.active,
    );
  }
}

/** Employee stub: resolves for 'e1', 404 otherwise, cross-depot manager → Forbidden. */
function fakeEmployees(): EmployeeService {
  return {
    getById: async (user: AuthenticatedUser, id: string) => {
      if (id !== 'e1') throw new NotFoundException('Karyawan tidak ditemukan');
      if (user.role === ('MANAGER' as never) && user.depotId !== DEPOT_A)
        throw new ForbiddenException('depot');
      return { id: 'e1', depotId: DEPOT_A } as never;
    },
  } as unknown as EmployeeService;
}

/** Only the business zone matters here; the rest of HrConfigService is untouched. */
function fakeConfig() {
  return { timeZone: 'Asia/Jakarta' } as unknown as import('../../src/config/hr-config.service').HrConfigService;
}

/**
 * The repayment ledger the balance is now read from (CA-1-05). `repaid` is what earlier
 * payslips actually took, keyed by loan id; empty = payroll has never collected anything.
 */
class FakePayrolls {
  /** One row per payslip line: which loan, which period, how much it really took. */
  ledger: { loanId: string; periodMonth: string; amount: number }[] = [];
  lastBefore?: string;
  async deductedBySourceRefBefore(
    _employeeId: string,
    beforePeriodMonth: string,
  ): Promise<Map<string, number>> {
    this.lastBefore = beforePeriodMonth;
    const out = new Map<string, number>();
    for (const row of this.ledger) {
      if (row.periodMonth >= beforePeriodMonth) continue;
      out.set(row.loanId, (out.get(row.loanId) ?? 0) + row.amount);
    }
    return out;
  }
}

function make() {
  const repo = new FakeRepo();
  const payrolls = new FakePayrolls();
  return {
    repo,
    payrolls,
    svc: new LoanService(
      repo,
      fakeEmployees(),
      fakeConfig(),
      payrolls as unknown as import('../../src/application/ports/payroll.repository').PayrollRepository,
    ),
  };
}

const base = {
  employeeId: 'e1',
  principal: 1_000_000,
  installmentAmount: 300_000,
  startPeriod: '2026-07',
};

describe('LoanService.create', () => {
  it('creates an active loan (note defaults to null)', async () => {
    const { repo, svc } = make();
    const l = await svc.create(hr, base);
    expect(repo.rows).toHaveLength(1);
    expect(l).toMatchObject({ active: true, note: null, createdBy: 'hr-1' });
  });

  it('validates principal, installment, and period format', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...base, principal: 0 })).rejects.toThrow(/principal harus/);
    await expect(svc.create(hr, { ...base, installmentAmount: 0 })).rejects.toThrow(
      /installmentAmount harus/,
    );
    await expect(svc.create(hr, { ...base, startPeriod: '2026-13' })).rejects.toThrow(/YYYY-MM/);
  });

  it('propagates the employee 404 guard', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...base, employeeId: 'x' })).rejects.toThrow(NotFoundException);
  });
});

describe('LoanService.deactivate', () => {
  it('404s on a missing loan', async () => {
    const { svc } = make();
    await expect(svc.deactivate(hr, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('depot-checks via the employee then flips active off', async () => {
    const { svc } = make();
    const l = await svc.create(hr, base);
    await expect(
      svc.deactivate(manager('99999999-9999-9999-9999-999999999999'), l.id),
    ).rejects.toThrow(ForbiddenException);
    const off = await svc.deactivate(hr, l.id);
    expect(off.active).toBe(false);
  });
});

describe('LoanService.listByEmployee', () => {
  it('computes remaining + settled from what payroll really took', async () => {
    const { payrolls, svc } = make();
    const loan = await svc.create(hr, base);
    for (const periodMonth of ['2026-07', '2026-08', '2026-09']) {
      payrolls.ledger.push({ loanId: loan.id, periodMonth, amount: 300_000 });
    }
    const views = await svc.listByEmployee(hr, 'e1', '2026-09');
    expect(views[0]).toMatchObject({ remaining: 100_000, settled: false });
    // Through '2026-09' inclusive — the ledger is asked for everything before October.
    expect(payrolls.lastBefore).toBe('2026-10');
  });

  // CA-1-05: the balance used to be months-elapsed × installment, so a month payroll never
  // ran for, and a month that could only afford part of an installment, both read as paid.
  it('does not write off an installment that was never collected', async () => {
    const { payrolls, svc } = make();
    const loan = await svc.create(hr, base);
    // Four months elapsed by 2026-10, but only two payslips ever took anything.
    payrolls.ledger.push({ loanId: loan.id, periodMonth: '2026-07', amount: 300_000 });
    payrolls.ledger.push({ loanId: loan.id, periodMonth: '2026-08', amount: 100_000 });
    const [view] = await svc.listByEmployee(hr, 'e1', '2026-10');
    expect(view).toMatchObject({ remaining: 600_000, settled: false });
  });

  it('shows the whole principal while no payroll has run at all', async () => {
    const { svc } = make();
    await svc.create(hr, base);
    const [view] = await svc.listByEmployee(hr, 'e1', '2026-10');
    expect(view).toMatchObject({ remaining: 1_000_000, settled: false });
  });

  it('falls back to the current month for an invalid period', async () => {
    const { svc } = make();
    await svc.create(hr, base);
    const views = await svc.listByEmployee(hr, 'e1', 'garbage');
    expect(typeof views[0].remaining).toBe('number');
    expect(typeof views[0].settled).toBe('boolean');
  });

  it('propagates the employee 404 guard', async () => {
    const { svc } = make();
    await expect(svc.listByEmployee(hr, 'x', '2026-07')).rejects.toThrow(NotFoundException);
  });
});

// C2: "which period are we in" was `new Date().toISOString().slice(0, 7)` — the UTC month.
// For the first seven hours of the 1st of every month WIB, that is still LAST month, so a
// courier opening their kasbon screen at 06:00 on 1 August was shown July's instalment as
// still due and August's as not yet started.
describe('LoanService.listForEmployee default period (C2)', () => {
  it('defaults to the LOCAL month, not the UTC one', async () => {
    const { repo, payrolls, svc } = make();
    // August's payslip already took an instalment. Read as JULY (the UTC month at this
    // instant) the ledger stops before August and the balance is still the full principal.
    payrolls.ledger.push({ loanId: 'l1', periodMonth: '2026-08', amount: 300_000 });
    repo.rows = [
      {
        id: 'l1',
        employeeId: 'e1',
        principal: 1_000_000,
        installmentAmount: 300_000,
        startPeriod: '2026-08',
        active: true,
      } as never,
    ];
    // 31 Jul 18:00 UTC = 1 Aug 01:00 WIB. In UTC this is still July, and the August
    // instalment would not have started yet.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    try {
      const [view] = await svc.listByEmployee(hr, 'e1', 'not-a-period');
      // August has started locally, so one instalment is already reckoned: 1.000.000 −
      // 300.000. Read as July it would still show the full 1.000.000.
      expect(view.remaining).toBe(700_000);
    } finally {
      jest.useRealTimers();
    }
  });
});

/*
 * CA-1-34. `/hr/loans/import` could put five hundred kasbon rows into the ledger in one
 * paste, and nothing listed them: the only way to see a loan was to know whose it was and
 * open that employee. A bulk-import wizard with no list is a one-way door — nobody could
 * check what the paste actually did, or find the row that was wrong.
 */
describe('LoanService.listAll', () => {
  /*
   * All against `e1`: `create` checks the employee exists, and the fake directory only
   * knows that one. Whose loan it is does not matter here — the list is about ALL of them,
   * and the employee join that names each row is the repository's job, tested there.
   */
  const seed = async (svc: LoanService, n: number, over: Record<string, unknown> = {}) => {
    for (let i = 0; i < n; i += 1) {
      await svc.create(hr, { ...base, note: `k${i}`, ...over });
    }
  };

  it('pages, newest-repository-order first, and reports the true total', async () => {
    const { svc } = make();
    await seed(svc, 5);

    const first = await svc.listAll(hr, { page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    // The total is the whole set, not the page — a list that reports its page size as the
    // total can never offer a second page.
    expect(first.total).toBe(5);
    expect((await svc.listAll(hr, { page: 3, pageSize: 2 })).rows).toHaveLength(1);
  });

  it('caps the page size rather than trusting the query string', async () => {
    const { repo, svc } = make();
    await seed(svc, 1);
    // `page * pageSize` is an OFFSET; an unbounded one makes Postgres walk the table.
    await svc.listAll(hr, { pageSize: 5_000 });
    expect(repo.lastListAll?.take).toBe(100);
    await svc.listAll(hr, { pageSize: 0 });
    expect(repo.lastListAll?.take).toBe(1);
  });

  it('asks for running loans only when told to', async () => {
    const { repo, svc } = make();
    await seed(svc, 1);
    await svc.listAll(hr, {});
    expect(repo.lastListAll?.activeOnly).toBeUndefined();
    await svc.listAll(hr, { activeOnly: true });
    expect(repo.lastListAll?.activeOnly).toBe(true);
  });

  it('carries the same balance the employee’s own screen shows', async () => {
    const { payrolls, svc } = make();
    await svc.create(hr, base);
    const [own] = await svc.listByEmployee(hr, 'e1', '2026-08');
    payrolls.ledger.push({ loanId: own!.id, periodMonth: '2026-07', amount: 300_000 });

    const [listed] = (await svc.listAll(hr, { asOfPeriod: '2026-08' })).rows;
    const [employeeView] = await svc.listByEmployee(hr, 'e1', '2026-08');
    // One number, one service. The two screens cannot disagree because they cannot differ.
    expect(listed!.remaining).toBe(employeeView!.remaining);
  });

  it('falls back to the LOCAL month when the period asked for is not one', async () => {
    const { svc, payrolls } = make();
    await svc.create(hr, { ...base, startPeriod: '2026-08' });
    // 31 Jul 18:00 UTC = 1 Aug 01:00 WIB — the hour a UTC month key still says July.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    try {
      await svc.listAll(hr, { asOfPeriod: 'bukan-periode' });
      expect(payrolls.lastBefore).toBe('2026-09');
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks payroll nothing when there are no loans to ask about', async () => {
    const { payrolls, svc } = make();
    const out = await svc.listAll(hr, {});
    expect(out).toEqual({ rows: [], total: 0 });
    // An empty page must not spend a query on an empty `IN ()`.
    expect(payrolls.lastBefore).toBeUndefined();
  });
});
