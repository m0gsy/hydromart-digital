import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Bonus, BonusType, Deduction, DeductionType } from '../../prisma/generated/client';
import {
  BonusRepository,
  DeductionRepository,
} from '../../src/application/ports/adjustment.repository';
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
  return { bonuses, deductions, svc: new AdjustmentService(bonuses, deductions, fakeEmployees()) };
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
