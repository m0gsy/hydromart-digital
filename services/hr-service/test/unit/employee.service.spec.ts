import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, EmploymentHistory, Prisma } from '../../prisma/generated/client';
import { EmployeeRepository, EmployeeListFilter } from '../../src/application/ports/employee.repository';
import { EmployeeService } from '../../src/application/services/employee.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'DEPOT_MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements EmployeeRepository {
  rows: Employee[] = [];
  history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[] = [];
  private seq = 0;

  async count(): Promise<number> {
    return this.rows.length;
  }
  async list(f: EmployeeListFilter): Promise<{ rows: Employee[]; total: number }> {
    let rows = this.rows;
    if (f.depotId) rows = rows.filter((r) => r.depotId === f.depotId);
    if (f.status) rows = rows.filter((r) => r.status === f.status);
    return { rows: rows.slice(f.skip, f.skip + f.take), total: rows.length };
  }
  async findById(id: string): Promise<Employee | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByAuthSubjectId(authSubjectId: string): Promise<Employee | null> {
    return this.rows.find((r) => r.authSubjectId === authSubjectId) ?? null;
  }
  async listHistory(employeeId: string): Promise<EmploymentHistory[]> {
    return this.history
      .filter((h) => (h as { employeeId?: string }).employeeId === employeeId)
      .map((h) => h as unknown as EmploymentHistory);
  }
  async create(
    data: Prisma.EmployeeCreateInput,
    history?: Prisma.EmploymentHistoryCreateWithoutEmployeeInput,
  ): Promise<Employee> {
    if (this.rows.some((r) => r.employeeCode === data.employeeCode)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['employeeCode'] },
      });
    }
    const row = { id: `emp-${++this.seq}`, ...data } as unknown as Employee;
    this.rows.push(row);
    if (history) this.history.push(history);
    return row;
  }
  async update(
    id: string,
    data: Prisma.EmployeeUpdateInput,
    history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[],
  ): Promise<Employee> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    this.history.push(...history);
    return row;
  }
}

const baseInput = {
  fullName: 'Budi',
  phone: '0811',
  depotId: DEPOT_A,
  position: 'Kurir',
  employmentStatus: 'PROBATION' as const,
  joinDate: '2026-01-01',
  salaryType: 'DAILY' as const,
  dailyRate: 50000,
};

function make() {
  const repo = new FakeRepo();
  return { repo, svc: new EmployeeService(repo) };
}

describe('EmployeeService (M1)', () => {
  it('mints a sequential HR-#### code and a HIRED history row on create', async () => {
    const { repo, svc } = make();
    const a = await svc.create(hr, baseInput);
    const b = await svc.create(hr, { ...baseInput, fullName: 'Siti' });
    expect(a.employeeCode).toBe('HR-0001');
    expect(b.employeeCode).toBe('HR-0002');
    expect(repo.history[0]).toMatchObject({ changeType: 'HIRED' });
  });

  it('rejects DAILY without a dailyRate and MONTHLY without a monthlyRate', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...baseInput, dailyRate: undefined })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      svc.create(hr, { ...baseInput, salaryType: 'MONTHLY', dailyRate: undefined }),
    ).rejects.toThrow(BadRequestException);
  });

  it('nulls the off-type rate (DAILY keeps dailyRate, drops monthlyRate)', async () => {
    const { svc } = make();
    const e = await svc.create(hr, { ...baseInput, monthlyRate: 999 });
    expect(e.monthlyRate).toBeNull();
    expect(Number(e.dailyRate)).toBe(50000);
  });

  it('forbids a depot manager creating staff for another depot', async () => {
    const { svc } = make();
    await expect(svc.create(manager(DEPOT_B), baseInput)).rejects.toThrow(ForbiddenException);
    await expect(svc.create(manager(DEPOT_A), baseInput)).resolves.toBeDefined();
  });

  it('scopes list to a depot manager’s own depot', async () => {
    const { svc } = make();
    await svc.create(hr, baseInput);
    await svc.create(hr, { ...baseInput, depotId: DEPOT_B });
    const own = await svc.list(manager(DEPOT_A), { page: 1, pageSize: 20 });
    expect(own.total).toBe(1);
    expect(own.rows[0].depotId).toBe(DEPOT_A);
    const all = await svc.list(hr, { page: 1, pageSize: 20 });
    expect(all.total).toBe(2);
  });

  it('getById 404s on a missing row and blocks cross-depot reads', async () => {
    const { svc } = make();
    const e = await svc.create(hr, baseInput);
    await expect(svc.getById(hr, 'nope')).rejects.toThrow(NotFoundException);
    await expect(svc.getById(manager(DEPOT_B), e.id)).rejects.toThrow(ForbiddenException);
    await expect(svc.getById(manager(DEPOT_A), e.id)).resolves.toMatchObject({ id: e.id });
  });

  it('logs a history row per changed tracked field on update', async () => {
    const { repo, svc } = make();
    const e = await svc.create(hr, baseInput);
    repo.history = [];
    await svc.update(hr, e.id, { position: 'Operator', employmentStatus: 'PERMANENT' });
    const kinds = repo.history.map((h) => h.changeType).sort();
    expect(kinds).toEqual(['employmentStatus', 'position']);
  });

  it('writes no history when a tracked field is set to its current value', async () => {
    const { repo, svc } = make();
    const e = await svc.create(hr, baseInput);
    repo.history = [];
    await svc.update(hr, e.id, { position: 'Kurir', fullName: 'Budi Baru' });
    expect(repo.history).toHaveLength(0);
  });
});
