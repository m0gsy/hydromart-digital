import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import {
  Bonus,
  BonusType,
  Deduction,
  DeductionType,
  PayrollStatus,
} from '../../prisma/generated/client';
import {
  BonusRepository,
  DeductionRepository,
} from '../../src/application/ports/adjustment.repository';
import { PayrollRepository } from '../../src/application/ports/payroll.repository';
import { AdjustmentService } from '../../src/application/services/adjustment.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

class FakeBonusRepo implements BonusRepository {
  rows: Bonus[] = [];
  async create(data: {
    employeeId: string;
    type: BonusType;
    amount: number;
    periodMonth: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<Bonus> {
    const row = { id: `b-${this.rows.length + 1}`, ...data } as unknown as Bonus;
    this.rows.push(row);
    return row;
  }
  async listByEmployeePeriod(employeeId: string, periodMonth: string): Promise<Bonus[]> {
    return this.rows.filter(
      (r) =>
        (r as unknown as { employeeId: string }).employeeId === employeeId &&
        (r as unknown as { periodMonth: string }).periodMonth === periodMonth,
    );
  }
  async findById(id: string): Promise<Bonus | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}

class FakeDeductionRepo implements DeductionRepository {
  rows: Deduction[] = [];
  async create(data: {
    employeeId: string;
    type: DeductionType;
    amount: number;
    periodMonth: string;
    note: string | null;
    createdBy: string | null;
  }): Promise<Deduction> {
    const row = { id: `d-${this.rows.length + 1}`, ...data } as unknown as Deduction;
    this.rows.push(row);
    return row;
  }
  async listByEmployeePeriod(employeeId: string, periodMonth: string): Promise<Deduction[]> {
    return this.rows.filter(
      (r) =>
        (r as unknown as { employeeId: string }).employeeId === employeeId &&
        (r as unknown as { periodMonth: string }).periodMonth === periodMonth,
    );
  }
  async findById(id: string): Promise<Deduction | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}

/** Only the one method the adjustment guard reads: is this period's payslip still open? */
class FakePayrolls {
  status: PayrollStatus | null = null;
  async findByEmployeeAndPeriod(): Promise<{ status: PayrollStatus } | null> {
    return this.status ? { status: this.status } : null;
  }
}

/** Employee stub: resolves for the known id, else 404; cross-depot manager → Forbidden. */
function fakeEmployees(): EmployeeService {
  return {
    getById: async (user: AuthenticatedUser, id: string) => {
      if (id !== 'e1') throw new NotFoundException('Karyawan tidak ditemukan');
      if (user.role === ('MANAGER' as never) && user.depotId !== DEPOT_A) {
        throw new ForbiddenException('depot');
      }
      return { id: 'e1', depotId: DEPOT_A } as never;
    },
  } as unknown as EmployeeService;
}

function make() {
  const bonuses = new FakeBonusRepo();
  const deductions = new FakeDeductionRepo();
  const payrolls = new FakePayrolls();
  return {
    bonuses,
    deductions,
    payrolls,
    svc: new AdjustmentService(
      bonuses,
      deductions,
      fakeEmployees(),
      payrolls as unknown as PayrollRepository,
    ),
  };
}

describe('AdjustmentService', () => {
  it('adds a bonus (note defaults to null, createdBy = caller)', async () => {
    const { bonuses, svc } = make();
    const b = await svc.addBonus(hr, {
      employeeId: 'e1',
      type: 'MANUAL' as BonusType,
      amount: 100000,
      periodMonth: '2026-07',
    });
    expect(bonuses.rows).toHaveLength(1);
    expect(b).toMatchObject({ note: null, createdBy: 'hr-1', amount: 100000 });
  });

  it('adds a bonus keeping an explicit note', async () => {
    const { svc } = make();
    const b = await svc.addBonus(hr, {
      employeeId: 'e1',
      type: 'MANUAL' as BonusType,
      amount: 5,
      periodMonth: '2026-07',
      note: 'THR',
    });
    expect(b.note).toBe('THR');
  });

  it('lists bonuses for an employee/period', async () => {
    const { svc } = make();
    await svc.addBonus(hr, {
      employeeId: 'e1',
      type: 'MANUAL' as BonusType,
      amount: 1,
      periodMonth: '2026-07',
    });
    const rows = await svc.listBonuses(hr, 'e1', '2026-07');
    expect(rows).toHaveLength(1);
  });

  it('adds + lists a deduction', async () => {
    const { deductions, svc } = make();
    await svc.addDeduction(hr, {
      employeeId: 'e1',
      type: 'CASH_ADVANCE' as DeductionType,
      amount: 20000,
      periodMonth: '2026-07',
      note: 'Kasbon',
    });
    expect(deductions.rows[0]).toMatchObject({ note: 'Kasbon', createdBy: 'hr-1' });
    const rows = await svc.listDeductions(hr, 'e1', '2026-07');
    expect(rows).toHaveLength(1);
  });

  it('deduction note defaults to null', async () => {
    const { deductions, svc } = make();
    await svc.addDeduction(hr, {
      employeeId: 'e1',
      type: 'CASH_ADVANCE' as DeductionType,
      amount: 1,
      periodMonth: '2026-07',
    });
    expect(deductions.rows[0].note).toBeNull();
  });

  it('propagates the employee 404 guard on every method', async () => {
    const { svc } = make();
    await expect(
      svc.addBonus(hr, {
        employeeId: 'x',
        type: 'MANUAL' as BonusType,
        amount: 1,
        periodMonth: '2026-07',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(svc.listBonuses(hr, 'x', '2026-07')).rejects.toThrow(NotFoundException);
    await expect(
      svc.addDeduction(hr, {
        employeeId: 'x',
        type: 'CASH_ADVANCE' as DeductionType,
        amount: 1,
        periodMonth: '2026-07',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(svc.listDeductions(hr, 'x', '2026-07')).rejects.toThrow(NotFoundException);
  });
});

const bonusInput = {
  employeeId: 'e1',
  type: 'MANUAL' as BonusType,
  amount: 100_000,
  periodMonth: '2026-07',
};
const deductionInput = {
  employeeId: 'e1',
  type: 'MANUAL' as DeductionType,
  amount: 50_000,
  periodMonth: '2026-07',
};

// CA-1-08 — a bonus is only ever paid by `PayrollService.generate`, and generate refuses to
// re-run once the payroll leaves DRAFT. So a bonus typed against an APPROVED period was
// saved, listed back, and paid to nobody, with nothing anywhere saying so.
describe('AdjustmentService — a period whose payslip is signed off (CA-1-08)', () => {
  it('refuses a bonus for an APPROVED period, and says where to put it instead', async () => {
    const { bonuses, payrolls, svc } = make();
    payrolls.status = 'APPROVED' as PayrollStatus;
    await expect(svc.addBonus(hr, bonusInput)).rejects.toThrow(ConflictException);
    await expect(svc.addBonus(hr, bonusInput)).rejects.toThrow(/periode berikutnya/);
    expect(bonuses.rows).toHaveLength(0);
  });

  it('refuses a deduction for a PAID period', async () => {
    const { deductions, payrolls, svc } = make();
    payrolls.status = 'PAID' as PayrollStatus;
    await expect(svc.addDeduction(hr, deductionInput)).rejects.toThrow(ConflictException);
    expect(deductions.rows).toHaveLength(0);
  });

  it('still accepts both while the payroll is DRAFT or not generated yet', async () => {
    const { bonuses, deductions, payrolls, svc } = make();
    payrolls.status = 'DRAFT' as PayrollStatus;
    await svc.addBonus(hr, bonusInput);
    payrolls.status = null;
    await svc.addDeduction(hr, deductionInput);
    expect(bonuses.rows).toHaveLength(1);
    expect(deductions.rows).toHaveLength(1);
  });
});

// CA-1-09 — there was no @Delete anywhere: a bonus typed as 5.000.000 instead of 500.000
// could only be cancelled by entering a 4.500.000 deduction against the same month.
describe('AdjustmentService — deleting a row typed by mistake (CA-1-09)', () => {
  it('removes a bonus while its period is still open', async () => {
    const { bonuses, svc } = make();
    const b = await svc.addBonus(hr, bonusInput);
    await svc.removeBonus(hr, b.id);
    expect(bonuses.rows).toHaveLength(0);
  });

  it('removes a deduction while its period is still open', async () => {
    const { deductions, svc } = make();
    const d = await svc.addDeduction(hr, deductionInput);
    await svc.removeDeduction(hr, d.id);
    expect(deductions.rows).toHaveLength(0);
  });

  it('404s on a row that is not there', async () => {
    const { svc } = make();
    await expect(svc.removeBonus(hr, 'nope')).rejects.toThrow(NotFoundException);
    await expect(svc.removeDeduction(hr, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('refuses to rewrite what an APPROVED payslip already counted', async () => {
    const { bonuses, deductions, payrolls, svc } = make();
    const b = await svc.addBonus(hr, bonusInput);
    const d = await svc.addDeduction(hr, deductionInput);
    payrolls.status = 'APPROVED' as PayrollStatus;
    await expect(svc.removeBonus(hr, b.id)).rejects.toThrow(ConflictException);
    await expect(svc.removeDeduction(hr, d.id)).rejects.toThrow(ConflictException);
    expect(bonuses.rows).toHaveLength(1);
    expect(deductions.rows).toHaveLength(1);
  });

  it('depot-checks through the owning employee', async () => {
    const { svc } = make();
    const b = await svc.addBonus(hr, bonusInput);
    const stranger: AuthenticatedUser = {
      sub: 'mgr',
      role: 'MANAGER' as never,
      phone: '0800',
      depotId: '99999999-9999-9999-9999-999999999999',
    };
    await expect(svc.removeBonus(stranger, b.id)).rejects.toThrow(ForbiddenException);
  });
});
