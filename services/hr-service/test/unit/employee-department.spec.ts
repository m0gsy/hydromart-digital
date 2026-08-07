import { BadRequestException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Department, Employee, EmploymentHistory, Prisma } from '../../prisma/generated/client';
import { DepartmentRepository } from '../../src/application/ports/department.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { EmployeeService } from '../../src/application/services/employee.service';
import { fakeIdentity } from './support/identity';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

const baseInput = {
  fullName: 'Budi',
  phone: '0811',
  depotId: DEPOT_A,
  position: 'Kurir',
  // "+ Tambah" mints the login too, so a new employee always carries a jabatan.
  role: 'STAFF_DEPOT' as const,
  employmentStatus: 'PROBATION' as const,
  joinDate: '2026-01-01',
  salaryType: 'DAILY' as const,
  dailyRate: 50000,
};

/** Only the calls the department rule touches; the rest throw if the rule strays. */
class FakeEmployees implements EmployeeRepository {
  /** HQ deleted the account behind this employee (Fase 6). */
  anonymisedAccounts: string[] = [];
  async anonymiseByAuthSubjectId(authSubjectId: string): Promise<number> {
    this.anonymisedAccounts.push(authSubjectId);
    return 1;
  }

  rows: Employee[] = [];
  private seq = 0;
  async count(): Promise<number> {
    return this.rows.length;
  }
  async create(data: Prisma.EmployeeCreateInput): Promise<Employee> {
    const row = { id: `emp-${++this.seq}`, ...data } as unknown as Employee;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Prisma.EmployeeUpdateInput): Promise<Employee> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findById(id: string): Promise<Employee | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(): Promise<{ rows: Employee[]; total: number }> {
    return { rows: this.rows, total: this.rows.length };
  }
  async findByAuthSubjectId(): Promise<Employee | null> {
    return null;
  }
  async findByEmployeeCode(employeeCode: string): Promise<Employee | null> {
    return this.rows.find((r) => r.employeeCode === employeeCode) ?? null;
  }
  async findByPhone(phone: string): Promise<Employee | null> {
    return this.rows.find((r) => r.phone === phone) ?? null;
  }
  async findByNik(nik: string): Promise<Employee | null> {
    return this.rows.find((r) => r.nik === nik) ?? null;
  }
  async findConflicting(keys: {
    employeeCode?: string;
    nik?: string;
    phone: string;
  }): Promise<'employeeCode' | 'nik' | 'phone' | null> {
    if (keys.employeeCode && (await this.findByEmployeeCode(keys.employeeCode))) return 'employeeCode';
    if (keys.nik && (await this.findByNik(keys.nik))) return 'nik';
    return (await this.findByPhone(keys.phone)) ? 'phone' : null;
  }
  async findByAuthSubjectIdOrPhone(
    _authSubjectId: string,
    phone: string,
  ): Promise<{ linked: Employee | null; oldestByPhone: Employee | null }> {
    return { linked: null, oldestByPhone: await this.findByPhone(phone) };
  }
  async listHistory(): Promise<EmploymentHistory[]> {
    return [];
  }
  async countRetentionEligible(): Promise<number> {
    return 0;
  }
  async anonymiseRetentionEligible(): Promise<number> {
    return 0;
  }
  async purgeFaceEmbeddings(): Promise<number> {
    return 0;
  }
}

class FakeDepartments implements DepartmentRepository {
  lookups = 0;
  rows: Department[] = [
    { id: 'dep-global', code: 'FIN', name: 'Keuangan', depotId: null } as Department,
    { id: 'dep-a', code: 'GDG-A', name: 'Gudang A', depotId: DEPOT_A } as Department,
    { id: 'dep-b', code: 'GDG-B', name: 'Gudang B', depotId: DEPOT_B } as Department,
  ];
  async findById(id: string): Promise<Department | null> {
    this.lookups++;
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(): Promise<Department> {
    throw new Error('not used');
  }
  async update(): Promise<Department> {
    throw new Error('not used');
  }
  async delete(): Promise<void> {
    throw new Error('not used');
  }
  async list(): Promise<Department[]> {
    return this.rows;
  }
}

function make() {
  const employees = new FakeEmployees();
  const departments = new FakeDepartments();
  return {
    employees,
    departments,
    svc: new EmployeeService(employees, fakeIdentity(), departments),
  };
}

describe('EmployeeService department assignment (A1)', () => {
  it('accepts a network-wide department for any depot', async () => {
    const { svc } = make();
    const e = await svc.create(hr, { ...baseInput, departmentId: 'dep-global' });
    expect(e).toMatchObject({ departmentId: 'dep-global' });
  });

  it('accepts a department owned by the employee’s own depot', async () => {
    const { svc } = make();
    const e = await svc.create(hr, { ...baseInput, departmentId: 'dep-a' });
    expect(e).toMatchObject({ departmentId: 'dep-a' });
  });

  it('rejects a department that belongs to another depot', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...baseInput, departmentId: 'dep-b' })).rejects.toThrow(
      /milik depot lain/,
    );
  });

  it('rejects an unknown department id', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...baseInput, departmentId: 'nope' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('stores null and looks nothing up when no department is given', async () => {
    const { departments, svc } = make();
    const e = await svc.create(hr, baseInput);
    expect(e).toMatchObject({ departmentId: null });
    expect(departments.lookups).toBe(0);
  });

  it('skips the check entirely when no department repository is wired', async () => {
    const employees = new FakeEmployees();
    const svc = new EmployeeService(employees, fakeIdentity());
    const e = await svc.create(hr, { ...baseInput, departmentId: 'dep-b' });
    expect(e).toMatchObject({ departmentId: 'dep-b' });
  });

  it('rejects moving an employee into another depot’s department', async () => {
    const { svc } = make();
    const e = await svc.create(hr, baseInput);
    await expect(svc.update(hr, e.id, { departmentId: 'dep-b' })).rejects.toThrow(
      /milik depot lain/,
    );
  });

  it('rejects a depot move that would strand a depot-owned department', async () => {
    const { svc } = make();
    const e = await svc.create(hr, { ...baseInput, departmentId: 'dep-a' });
    await expect(svc.update(hr, e.id, { depotId: DEPOT_B })).rejects.toThrow(/milik depot lain/);
  });

  it('allows a depot move when the department is network-wide', async () => {
    const { svc } = make();
    const e = await svc.create(hr, { ...baseInput, departmentId: 'dep-global' });
    const moved = await svc.update(hr, e.id, { depotId: DEPOT_B });
    expect(moved).toMatchObject({ depotId: DEPOT_B, departmentId: 'dep-global' });
  });

  it('lets an unassigned employee move depots without a lookup', async () => {
    const { departments, svc } = make();
    const e = await svc.create(hr, baseInput);
    const moved = await svc.update(hr, e.id, { depotId: DEPOT_B });
    expect(moved).toMatchObject({ depotId: DEPOT_B, departmentId: null });
    expect(departments.lookups).toBe(0);
  });

  it('does not re-check on an unrelated update', async () => {
    const { departments, svc } = make();
    const e = await svc.create(hr, { ...baseInput, departmentId: 'dep-a' });
    const before = departments.lookups;
    await svc.update(hr, e.id, { position: 'Admin' });
    expect(departments.lookups).toBe(before);
  });
});
