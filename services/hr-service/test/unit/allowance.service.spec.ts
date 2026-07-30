import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Allowance } from '../../prisma/generated/client';
import {
  AllowanceRepository,
  AllowanceWrite,
} from '../../src/application/ports/allowance.repository';
import { AllowanceService } from '../../src/application/services/allowance.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

class FakeRepo implements AllowanceRepository {
  rows: Allowance[] = [];
  lastPeriod?: { employeeId: string; from: Date; to: Date };
  private seq = 0;
  async create(data: AllowanceWrite): Promise<Allowance> {
    const row = { id: `al-${++this.seq}`, ...data } as unknown as Allowance;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Partial<AllowanceWrite>): Promise<Allowance> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findById(id: string): Promise<Allowance | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByEmployee(employeeId: string): Promise<Allowance[]> {
    return this.rows.filter((r) => r.employeeId === employeeId);
  }
  async listActiveForPeriod(employeeId: string, from: Date, to: Date): Promise<Allowance[]> {
    this.lastPeriod = { employeeId, from, to };
    return this.rows.filter((r) => r.active);
  }
}

/** EmployeeService stand-in: getById is the 404 + depot gate every write goes through. */
function fakeEmployees(found = true): EmployeeService {
  return {
    getById: jest.fn(async (_u: AuthenticatedUser, id: string) => {
      if (!found) throw new NotFoundException('Karyawan tidak ditemukan');
      return { id, depotId: 'd1' };
    }),
  } as unknown as EmployeeService;
}

function make(employeeFound = true) {
  const repo = new FakeRepo();
  const employees = fakeEmployees(employeeFound);
  return { repo, employees, svc: new AllowanceService(repo, employees) };
}

const input = {
  employeeId: 'emp-1',
  type: 'TRANSPORT' as const,
  amount: 300_000,
  effectiveFrom: '2026-08-01',
};

describe('AllowanceService.add', () => {
  it('creates an open-ended active allowance stamped with the actor', async () => {
    const { svc } = make();
    const a = await svc.add(hr, input);
    expect(a).toMatchObject({
      employeeId: 'emp-1',
      type: 'TRANSPORT',
      amount: 300_000,
      effectiveTo: null,
      active: true,
      note: null,
      createdBy: 'hr-1',
    });
  });

  it('keeps the note and the end date when given', async () => {
    const { svc } = make();
    const a = await svc.add(hr, { ...input, effectiveTo: '2026-12-31', note: 'Tunjangan rute' });
    expect(a.note).toBe('Tunjangan rute');
    expect(a.effectiveTo).toEqual(new Date('2026-12-31'));
  });

  it('rejects an end date before the start date', async () => {
    const { svc } = make();
    await expect(svc.add(hr, { ...input, effectiveTo: '2026-07-01' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('goes through the employee gate (404 / wrong depot propagates)', async () => {
    const { svc } = make(false);
    await expect(svc.add(hr, input)).rejects.toThrow(NotFoundException);
  });
});

describe('AllowanceService.list', () => {
  it('depot-checks then returns the employee’s rows', async () => {
    const { employees, svc } = make();
    await svc.add(hr, input);
    expect(await svc.list(hr, 'emp-1')).toHaveLength(1);
    expect(employees.getById).toHaveBeenCalledWith(hr, 'emp-1');
  });
});

describe('AllowanceService.deactivate', () => {
  it('closes the row instead of deleting it — a past payslip must stay explainable', async () => {
    const { repo, svc } = make();
    const a = await svc.add(hr, input);
    const off = await svc.deactivate(hr, a.id);
    expect(off.active).toBe(false);
    expect(repo.rows).toHaveLength(1);
  });

  it('404s on a missing allowance', async () => {
    const { svc } = make();
    await expect(svc.deactivate(hr, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('depot-checks through the owning employee', async () => {
    const { repo, svc } = make();
    const a = await svc.add(hr, input);
    const blocked = new AllowanceService(repo, fakeEmployees(false));
    await expect(blocked.deactivate(hr, a.id)).rejects.toThrow(NotFoundException);
  });
});
