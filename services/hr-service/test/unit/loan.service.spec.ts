import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Loan } from '../../prisma/generated/client';
import { LoanRepository, LoanWrite } from '../../src/application/ports/loan.repository';
import { LoanService } from '../../src/application/services/loan.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({ sub: 'mgr-1', role: 'DEPOT_MANAGER' as never, phone: '0800', depotId });

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
  async listByEmployee(employeeId: string): Promise<Loan[]> {
    return this.rows.filter((r) => (r as unknown as { employeeId: string }).employeeId === employeeId);
  }
  async listActiveByEmployee(employeeId: string): Promise<Loan[]> {
    return this.rows.filter((r) => (r as unknown as { employeeId: string }).employeeId === employeeId && r.active);
  }
}

/** Employee stub: resolves for 'e1', 404 otherwise, cross-depot manager → Forbidden. */
function fakeEmployees(): EmployeeService {
  return {
    getById: async (user: AuthenticatedUser, id: string) => {
      if (id !== 'e1') throw new NotFoundException('Karyawan tidak ditemukan');
      if (user.role === ('DEPOT_MANAGER' as never) && user.depotId !== DEPOT_A) throw new ForbiddenException('depot');
      return { id: 'e1', depotId: DEPOT_A } as never;
    },
  } as unknown as EmployeeService;
}

function make() {
  const repo = new FakeRepo();
  return { repo, svc: new LoanService(repo, fakeEmployees()) };
}

const base = { employeeId: 'e1', principal: 1_000_000, installmentAmount: 300_000, startPeriod: '2026-07' };

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
    await expect(svc.create(hr, { ...base, installmentAmount: 0 })).rejects.toThrow(/installmentAmount harus/);
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
    await expect(svc.deactivate(manager('99999999-9999-9999-9999-999999999999'), l.id)).rejects.toThrow(ForbiddenException);
    const off = await svc.deactivate(hr, l.id);
    expect(off.active).toBe(false);
  });
});

describe('LoanService.listByEmployee', () => {
  it('computes remaining + settled as of the requested period', async () => {
    const { svc } = make();
    await svc.create(hr, base);
    const views = await svc.listByEmployee(hr, 'e1', '2026-09');
    expect(views[0]).toMatchObject({ remaining: 100_000, settled: false });
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
