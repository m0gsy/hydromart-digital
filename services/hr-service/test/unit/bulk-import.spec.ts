import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import {
  Allowance,
  AssetStatus,
  Deduction,
  EmployeeAsset,
  LeaveBalance,
  Loan,
  Prisma,
} from '../../prisma/generated/client';
import {
  AllowanceRepository,
  AllowanceWrite,
} from '../../src/application/ports/allowance.repository';
import {
  AssetMovementWrite,
  AssetRepository,
  AssetWrite,
} from '../../src/application/ports/asset.repository';
import { DeductionRepository } from '../../src/application/ports/adjustment.repository';
import { LeaveRepository } from '../../src/application/ports/leave.repository';
import { LoanRepository, LoanWrite } from '../../src/application/ports/loan.repository';
import { AdjustmentService } from '../../src/application/services/adjustment.service';
import { AllowanceService } from '../../src/application/services/allowance.service';
import { AssetService } from '../../src/application/services/asset.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { LeaveService } from '../../src/application/services/leave.service';
import { LoanService } from '../../src/application/services/loan.service';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const DEPOT = 'd1';

/**
 * EmployeeService stand-in. `getByCode` is the gate every one of these imports goes through:
 * unknown code → BadRequest, wrong depot → the same rejection the real one raises.
 */
function fakeEmployees(known: Record<string, string> = { 'HR-0001': DEPOT }): EmployeeService {
  return {
    getByCode: jest.fn(async (_u: AuthenticatedUser, code: string) => {
      const depotId = known[code.trim().toUpperCase()];
      if (!depotId) throw new BadRequestException(`Kode karyawan "${code}" tidak ditemukan`);
      return { id: `emp-${code}`, depotId };
    }),
    // Asset hand-over re-reads the recipient by id; keep it on the same depot the code says.
    getById: jest.fn(async (_u: AuthenticatedUser, id: string) => ({
      id,
      depotId: known[id.replace(/^emp-/, '')] ?? DEPOT,
    })),
  } as unknown as EmployeeService;
}

describe('AllowanceService.importMany', () => {
  class FakeRepo implements AllowanceRepository {
    rows: Allowance[] = [];
    private seq = 0;
    async create(data: AllowanceWrite): Promise<Allowance> {
      const row = { id: `al-${++this.seq}`, ...data } as unknown as Allowance;
      this.rows.push(row);
      return row;
    }
    async update(): Promise<Allowance> {
      throw new Error('unused');
    }
    async findById(): Promise<Allowance | null> {
      return null;
    }
    async listByEmployee(): Promise<Allowance[]> {
      return this.rows;
    }
    async listActiveForPeriod(): Promise<Allowance[]> {
      return this.rows;
    }
  }

  const row = {
    employeeCode: 'HR-0001',
    type: 'TRANSPORT' as const,
    amount: 300_000,
    effectiveFrom: '2026-08-01',
  };

  it('resolves the staff code and writes the allowance', async () => {
    const repo = new FakeRepo();
    const svc = new AllowanceService(repo, fakeEmployees());

    const summary = await svc.importMany(hr, [row]);

    expect(summary).toMatchObject({ created: 1, updated: 0, failed: 0 });
    expect(repo.rows[0]).toMatchObject({ employeeId: 'emp-HR-0001', amount: 300_000 });
  });

  it('fails only the row whose staff code is unknown', async () => {
    const repo = new FakeRepo();
    const svc = new AllowanceService(repo, fakeEmployees());

    const summary = await svc.importMany(hr, [{ ...row, employeeCode: 'HR-9999' }, row]);

    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(summary.results[0]?.message).toContain('HR-9999');
    expect(repo.rows).toHaveLength(1);
  });

  it('propagates the end-before-start rejection per row', async () => {
    const svc = new AllowanceService(new FakeRepo(), fakeEmployees());

    const summary = await svc.importMany(hr, [{ ...row, effectiveTo: '2026-07-01' }]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
  });
});

describe('AdjustmentService.importDeductions', () => {
  class FakeDeductions implements DeductionRepository {
    rows: Deduction[] = [];
    private seq = 0;
    async create(data: {
      employeeId: string;
      type: Deduction['type'];
      amount: number;
      periodMonth: string;
      note: string | null;
      createdBy: string | null;
    }): Promise<Deduction> {
      const row = { id: `de-${++this.seq}`, ...data } as unknown as Deduction;
      this.rows.push(row);
      return row;
    }
    async listByEmployeePeriod(): Promise<Deduction[]> {
      return this.rows;
    }
    async findById(): Promise<Deduction | null> {
      return null;
    }
    async delete(): Promise<void> {}
  }
  /** No payroll generated yet, so every imported period is still open (CA-1-08). */
  const openPayrolls = { findByEmployeeAndPeriod: async () => null } as never;

  const row = {
    employeeCode: 'HR-0001',
    type: 'MANUAL' as const,
    amount: 50_000,
    periodMonth: '2026-07',
  };

  it('writes one deduction per row, keyed by staff code', async () => {
    const deductions = new FakeDeductions();
    const svc = new AdjustmentService({} as never, deductions, fakeEmployees(), openPayrolls);

    const summary = await svc.importDeductions(hr, [row, row]);

    // Two identical rows stay two rows on purpose — HR may genuinely deduct twice.
    expect(summary).toMatchObject({ created: 2, failed: 0 });
    expect(deductions.rows).toHaveLength(2);
    expect(deductions.rows[0]).toMatchObject({ employeeId: 'emp-HR-0001', createdBy: 'hr-1' });
  });

  it('fails the row whose staff code is unknown', async () => {
    const deductions = new FakeDeductions();
    const svc = new AdjustmentService({} as never, deductions, fakeEmployees(), openPayrolls);

    const summary = await svc.importDeductions(hr, [{ ...row, employeeCode: 'HR-4242' }]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
    expect(deductions.rows).toHaveLength(0);
  });
});

describe('LoanService.importMany', () => {
  class FakeRepo implements LoanRepository {
    rows: Loan[] = [];
    private seq = 0;
    async create(data: LoanWrite): Promise<Loan> {
      const row = { id: `ln-${++this.seq}`, ...data } as unknown as Loan;
      this.rows.push(row);
      return row;
    }
    /** CA-1-34: the network-wide list. Not what this file tests — present so the fake is a
     *  faithful stand-in for the port rather than a subset of it. */
    async listAll() {
      return { rows: [], total: 0 };
    }
    async update(): Promise<Loan> {
      throw new Error('unused');
    }
    async findById(): Promise<Loan | null> {
      return null;
    }
    async listByEmployee(): Promise<Loan[]> {
      return this.rows;
    }
    async listActiveByEmployee(): Promise<Loan[]> {
      return this.rows.filter((r) => r.active);
    }
  }

  const row = {
    employeeCode: 'HR-0001',
    principal: 1_500_000,
    installmentAmount: 250_000,
    startPeriod: '2026-08',
  };

  it('creates an active loan from the remaining balance', async () => {
    const repo = new FakeRepo();
    const svc = new LoanService(repo, fakeEmployees(), { timeZone: 'Asia/Jakarta' } as never, {} as never);

    const summary = await svc.importMany(hr, [row]);

    expect(summary).toMatchObject({ created: 1, failed: 0 });
    expect(repo.rows[0]).toMatchObject({
      employeeId: 'emp-HR-0001',
      principal: 1_500_000,
      active: true,
    });
  });

  it('fails a row with a malformed period instead of the whole file', async () => {
    const repo = new FakeRepo();
    const svc = new LoanService(repo, fakeEmployees(), { timeZone: 'Asia/Jakarta' } as never, {} as never);

    const summary = await svc.importMany(hr, [{ ...row, startPeriod: 'Agustus' }, row]);

    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(summary.results[0]?.message).toContain('YYYY-MM');
  });
});

describe('LeaveService.importBalances', () => {
  class FakeRepo implements Partial<LeaveRepository> {
    balances: LeaveBalance[] = [];
    async findBalance(employeeId: string, year: number): Promise<LeaveBalance | null> {
      return this.balances.find((b) => b.employeeId === employeeId && b.year === year) ?? null;
    }
    async setBalance(
      employeeId: string,
      year: number,
      quotaDays: number,
      usedDays: number,
    ): Promise<{ balance: LeaveBalance; existed: boolean }> {
      const found = await this.findBalance(employeeId, year);
      if (found) {
        found.quotaDays = quotaDays;
        found.usedDays = usedDays;
        return { balance: found, existed: true };
      }
      const row = { id: `bal-${year}`, employeeId, year, quotaDays, usedDays } as LeaveBalance;
      this.balances.push(row);
      return { balance: row, existed: false };
    }
  }

  function make() {
    const repo = new FakeRepo();
    const employees = fakeEmployees();
    // importBalances touches only the repo and the employee gate.
    const svc = new LeaveService(
      repo as unknown as LeaveRepository,
      {} as never,
      employees,
      {} as never,
    );
    return { repo, svc };
  }

  const row = { employeeCode: 'HR-0001', year: 2026, quotaDays: 12, usedDays: 5 };

  it('carries the opening quota and the days already taken', async () => {
    const { repo, svc } = make();

    const summary = await svc.importBalances(hr, [row]);

    expect(summary).toMatchObject({ created: 1, updated: 0, failed: 0 });
    expect(repo.balances[0]).toMatchObject({ quotaDays: 12, usedDays: 5 });
  });

  it('defaults usedDays to zero when the column is blank', async () => {
    const { repo, svc } = make();

    await svc.importBalances(hr, [{ employeeCode: 'HR-0001', year: 2026, quotaDays: 12 }]);

    expect(repo.balances[0]?.usedDays).toBe(0);
  });

  it('overwrites a year that already has a balance and reports it as updated', async () => {
    const { repo, svc } = make();
    await svc.importBalances(hr, [row]);

    const second = await svc.importBalances(hr, [{ ...row, quotaDays: 15, usedDays: 2 }]);

    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(repo.balances).toHaveLength(1);
    expect(repo.balances[0]).toMatchObject({ quotaDays: 15, usedDays: 2 });
  });

  it('rejects a row claiming more days taken than the quota allows', async () => {
    const { repo, svc } = make();

    const summary = await svc.importBalances(hr, [{ ...row, quotaDays: 4, usedDays: 9 }]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
    expect(summary.results[0]?.message).toContain('quotaDays');
    expect(repo.balances).toHaveLength(0);
  });
});

describe('AssetService.importMany', () => {
  class FakeRepo implements AssetRepository {
    rows: EmployeeAsset[] = [];
    movements: AssetMovementWrite[] = [];
    private seq = 0;
    async create(data: AssetWrite): Promise<EmployeeAsset> {
      if (this.rows.some((r) => r.code === data.code)) {
        // Mirrors the P2002 the real repo raises, which AssetService turns into a Conflict.
        throw new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['code'] },
        });
      }
      const row = {
        id: `as-${++this.seq}`,
        status: 'AVAILABLE' as AssetStatus,
        holderId: null,
        ...data,
      } as unknown as EmployeeAsset;
      this.rows.push(row);
      return row;
    }
    async update(): Promise<EmployeeAsset> {
      throw new Error('unused');
    }
    async findById(id: string): Promise<EmployeeAsset | null> {
      return this.rows.find((r) => r.id === id) ?? null;
    }
    async list(): Promise<{ rows: EmployeeAsset[]; total: number }> {
      return { rows: this.rows, total: this.rows.length };
    }
    async move(
      movement: AssetMovementWrite,
      next: { status: AssetStatus; holderId: string | null },
    ): Promise<EmployeeAsset> {
      this.movements.push(movement);
      const row = this.rows.find((r) => r.id === movement.assetId)!;
      Object.assign(row, next);
      return row;
    }
    async listMovements(): Promise<never[]> {
      return [];
    }
  }

  const row = {
    code: 'mtr-0001',
    type: 'MOTORCYCLE' as const,
    name: 'Honda Vario',
    depotId: DEPOT,
  };

  it('registers the asset with an upper-cased tag', async () => {
    const repo = new FakeRepo();
    const svc = new AssetService(repo, fakeEmployees());

    const summary = await svc.importMany(hr, [row]);

    expect(summary).toMatchObject({ created: 1, failed: 0 });
    expect(repo.rows[0]).toMatchObject({ code: 'MTR-0001', status: 'AVAILABLE', holderId: null });
  });

  it('hands the asset over through the movement log when a holder is named', async () => {
    const repo = new FakeRepo();
    const svc = new AssetService(repo, fakeEmployees());

    await svc.importMany(hr, [{ ...row, holderEmployeeCode: 'HR-0001' }]);

    expect(repo.rows[0]).toMatchObject({ status: 'ASSIGNED', holderId: 'emp-HR-0001' });
    expect(repo.movements[0]).toMatchObject({ kind: 'ASSIGN', toEmployeeId: 'emp-HR-0001' });
  });

  it('keeps the asset registered when the hand-over fails, and says why', async () => {
    const repo = new FakeRepo();
    const svc = new AssetService(repo, fakeEmployees());

    const summary = await svc.importMany(hr, [{ ...row, holderEmployeeCode: 'HR-7777' }]);

    // 'created', not 'failed': the asset exists, so a re-upload would be a duplicate.
    expect(summary).toMatchObject({ created: 1, failed: 0 });
    expect(summary.results[0]?.message).toContain('belum diserahkan');
    expect(repo.rows[0]).toMatchObject({ status: 'AVAILABLE', holderId: null });
  });

  it('refuses a holder from another depot but leaves the asset on the books', async () => {
    const repo = new FakeRepo();
    const svc = new AssetService(repo, fakeEmployees({ 'HR-0001': 'other-depot' }));

    const summary = await svc.importMany(hr, [{ ...row, holderEmployeeCode: 'HR-0001' }]);

    expect(summary.results[0]?.message).toContain('depot lain');
    expect(repo.rows[0]?.holderId).toBeNull();
  });

  it('skips a re-uploaded asset code rather than failing it', async () => {
    const repo = new FakeRepo();
    const svc = new AssetService(repo, fakeEmployees());
    await svc.importMany(hr, [row]);

    const second = await svc.importMany(hr, [row]);

    expect(second).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(repo.rows).toHaveLength(1);
  });

  it('reports a genuine repository error as a failed row', async () => {
    const repo = new FakeRepo();
    jest.spyOn(repo, 'create').mockRejectedValueOnce(new ConflictException('disk penuh'));
    const svc = new AssetService(repo, fakeEmployees());

    const summary = await svc.importMany(hr, [row]);

    expect(summary).toMatchObject({ created: 0, skipped: 0, failed: 1 });
  });
});
