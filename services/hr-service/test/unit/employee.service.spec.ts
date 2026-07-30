import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, EmploymentHistory, Prisma } from '../../prisma/generated/client';
import {
  EmployeeRepository,
  EmployeeListFilter,
} from '../../src/application/ports/employee.repository';
import { EmployeeService } from '../../src/application/services/employee.service';
import { fakeIdentity } from './support/identity';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements EmployeeRepository {
  /** Retention report: departed rows dormant since before the cutoff. */
  retentionEligible = 0;
  /** Retention enforcement: rows anonymised / embeddings purged, recorded for assertions. */
  anonymised = 0;
  facesPurged = 0;
  async anonymiseRetentionEligible(): Promise<number> {
    return this.anonymised;
  }
  async purgeFaceEmbeddings(): Promise<number> {
    return this.facesPurged;
  }

  async countRetentionEligible(): Promise<number> {
    return this.retentionEligible;
  }

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
  async findByEmployeeCode(employeeCode: string): Promise<Employee | null> {
    return this.rows.find((r) => r.employeeCode === employeeCode) ?? null;
  }
  async findByPhone(phone: string): Promise<Employee | null> {
    return this.rows.find((r) => r.phone === phone) ?? null;
  }
  async findByNik(nik: string): Promise<Employee | null> {
    return this.rows.find((r) => r.nik === nik) ?? null;
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
    // Employee.nik is @unique too — the import's second upsert key.
    if (data.nik && this.rows.some((r) => r.nik === data.nik)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['nik'] },
      });
    }
    // Employee.authSubjectId is @unique in the schema — the fake honours it so the
    // import specs exercise the real duplicate path.
    if (data.authSubjectId && this.rows.some((r) => r.authSubjectId === data.authSubjectId)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['authSubjectId'] },
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
  const identity = fakeIdentity();
  return { repo, identity, svc: new EmployeeService(repo, identity) };
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

describe('EmployeeService.importMany', () => {
  const row = { ...baseInput, role: 'KEPALA_DEPOT' as const };

  it('provisions a login per row and links it to the employee', async () => {
    const { repo, identity, svc } = make();

    const summary = await svc.importMany(hr, [
      row,
      { ...row, fullName: 'Siti', phone: '0812', role: 'STAFF_DEPOT' },
    ]);

    expect(summary).toMatchObject({ created: 2, skipped: 0, failed: 0 });
    expect(identity.calls).toEqual([
      { phone: '0811', role: 'KEPALA_DEPOT', fullName: 'Budi', depotId: DEPOT_A },
      { phone: '0812', role: 'STAFF_DEPOT', fullName: 'Siti', depotId: DEPOT_A },
    ]);
    expect(repo.rows.map((r) => r.authSubjectId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });

  it('fails only the offending row and keeps importing the rest', async () => {
    const { repo, svc } = make();

    const summary = await svc.importMany(hr, [
      { ...row, dailyRate: undefined },
      { ...row, fullName: 'Siti', phone: '0812' },
    ]);

    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(summary.results[0]).toMatchObject({ row: 1, status: 'failed' });
    expect(summary.results[0]?.message).toContain('dailyRate');
    expect(summary.results[1]).toMatchObject({ row: 2, status: 'created' });
    expect(repo.rows).toHaveLength(1);
  });

  it('skips a row whose account is already linked to an employee (re-upload)', async () => {
    const repo = new FakeRepo();
    // Same phone twice -> auth-service hands back the same account both times.
    const svc = new EmployeeService(repo, {
      provisionStaff: async () => ({ customerId: 'auth-same' }),
    });

    await svc.importMany(hr, [row]);
    const second = await svc.importMany(hr, [row]);

    expect(second).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(repo.rows).toHaveLength(1);
  });

  it('writes no employee when auth-service refuses to create the account', async () => {
    const { repo, identity, svc } = make();
    identity.fail(new Error('auth-service menolak pembuatan akun (503)'));

    const summary = await svc.importMany(hr, [row]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
    expect(summary.results[0]?.message).toContain('503');
    // The whole point of failing hard: no employee left behind without a login.
    expect(repo.rows).toHaveLength(0);
  });

  it('refuses to import into a depot the caller cannot touch', async () => {
    const { repo, svc } = make();

    const summary = await svc.importMany(manager(DEPOT_B), [row]);

    expect(summary).toMatchObject({ created: 0, failed: 1 });
    expect(repo.rows).toHaveLength(0);
  });

  it('returns an empty summary for an empty batch', async () => {
    const { svc } = make();
    await expect(svc.importMany(hr, [])).resolves.toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
  });
});

describe('EmployeeService.importMany — codes, supervisors and upsert', () => {
  const row = { ...baseInput, role: 'KEPALA_DEPOT' as const };

  it('keeps the code the file supplies instead of minting one', async () => {
    const { repo, svc } = make();

    await svc.importMany(hr, [{ ...row, employeeCode: 'staff-7' }]);

    expect(repo.rows[0]?.employeeCode).toBe('STAFF-7');
  });

  it('skips — never renames — a row whose supplied code is already taken', async () => {
    const { repo, svc } = make();
    await svc.importMany(hr, [{ ...row, employeeCode: 'STAFF-7' }]);

    const second = await svc.importMany(hr, [
      { ...row, employeeCode: 'STAFF-7', fullName: 'Orang Lain', phone: '0899' },
    ]);

    expect(second).toMatchObject({ created: 0, skipped: 1 });
    expect(repo.rows).toHaveLength(1);
  });

  it('resolves a supervisor who only appears further down the same file', async () => {
    const { repo, svc } = make();

    const summary = await svc.importMany(hr, [
      { ...row, fullName: 'Anak Buah', supervisorCode: 'HR-0002' },
      { ...row, fullName: 'Bos', phone: '0812' },
    ]);

    expect(summary).toMatchObject({ created: 2, failed: 0 });
    expect(repo.rows[0]?.supervisorId).toBe(repo.rows[1]?.id);
  });

  it('keeps the row but says so when the supervisor code does not exist', async () => {
    const { repo, svc } = make();

    const summary = await svc.importMany(hr, [{ ...row, supervisorCode: 'HR-9999' }]);

    expect(summary).toMatchObject({ created: 1, failed: 0 });
    expect(summary.results[0]?.message).toContain('HR-9999');
    expect(repo.rows[0]?.supervisorId).toBeNull();
  });

  it('CREATE mode leaves an existing person alone', async () => {
    const { repo, svc } = make();
    await svc.importMany(hr, [{ ...row, employeeCode: 'STAFF-7' }]);

    const second = await svc.importMany(hr, [
      { ...row, employeeCode: 'STAFF-7', position: 'Supervisor' },
    ]);

    expect(second).toMatchObject({ created: 0, skipped: 1, updated: 0 });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.position).toBe('Kurir');
  });

  it('UPSERT matches on the staff code the file carries', async () => {
    const { repo, svc } = make();
    await svc.importMany(hr, [{ ...row, employeeCode: 'STAFF-7' }]);

    const second = await svc.importMany(
      hr,
      [{ ...row, employeeCode: 'STAFF-7', position: 'Supervisor' }],
      'UPSERT',
    );

    expect(second).toMatchObject({ updated: 1 });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.position).toBe('Supervisor');
  });

  it('UPSERT overwrites the matched employee without touching their login', async () => {
    const { repo, identity, svc } = make();
    await svc.importMany(hr, [row]);
    identity.calls.length = 0;

    const second = await svc.importMany(hr, [{ ...row, position: 'Supervisor' }], 'UPSERT');

    expect(second).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.position).toBe('Supervisor');
    // Re-provisioning would rewrite the person's role in every service that reads the JWT.
    expect(identity.calls).toEqual([]);
  });

  it('UPSERT matches on NIK when the file carries no staff code', async () => {
    const { repo, svc } = make();
    await svc.importMany(hr, [{ ...row, nik: '3201010101010001' }]);

    const second = await svc.importMany(
      hr,
      // Different phone — only the NIK ties the two rows together.
      [{ ...row, nik: '3201010101010001', phone: '0899', fullName: 'Budi Santoso' }],
      'UPSERT',
    );

    expect(second).toMatchObject({ updated: 1 });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.phone).toBe('0899');
  });

  it('UPSERT creates the row when nothing matches', async () => {
    const { repo, svc } = make();

    const summary = await svc.importMany(hr, [row], 'UPSERT');

    expect(summary).toMatchObject({ created: 1, updated: 0 });
    expect(repo.rows).toHaveLength(1);
  });

  it('rejects a contract that ends before it starts', async () => {
    const { svc } = make();

    await expect(
      svc.create(hr, { ...baseInput, contractEndDate: '2025-12-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the personal fields the import carries', async () => {
    const { repo, svc } = make();

    await svc.create(hr, {
      ...baseInput,
      nik: '3201010101010002',
      birthDate: '1995-04-02',
      gender: 'FEMALE',
      address: 'Jl. Melati 3',
      ptkpStatus: 'K1',
      contractEndDate: '2027-01-01',
    });

    expect(repo.rows[0]).toMatchObject({
      nik: '3201010101010002',
      gender: 'FEMALE',
      address: 'Jl. Melati 3',
      ptkpStatus: 'K1',
    });
    expect(repo.rows[0]?.birthDate).toEqual(new Date('1995-04-02'));
  });

  it('reports a duplicate NIK as a taken row, not a crash', async () => {
    const { svc } = make();
    await svc.create(hr, { ...baseInput, nik: '3201010101010003' });

    await expect(
      svc.create(hr, { ...baseInput, phone: '0899', nik: '3201010101010003' }),
    ).rejects.toThrow('NIK sudah dipakai');
  });
});

describe('EmployeeService.retentionReport (M23-21)', () => {
  it('reports the eligible count and deletes nothing', async () => {
    const repo = new FakeRepo();
    repo.retentionEligible = 4;
    const service = new EmployeeService(repo, { provisionStaff: jest.fn() } as never);

    expect(await service.retentionReport(new Date('2026-01-01'))).toEqual({ eligible: 4 });
    // The report path must never remove a row — deletion is a human decision.
    expect(repo.rows).toEqual(repo.rows);
  });
});

describe('EmployeeService retention enforcement', () => {
  it('anonymises departed records and reports how many', async () => {
    const repo = new FakeRepo();
    repo.anonymised = 3;
    const service = new EmployeeService(repo, { provisionStaff: jest.fn() } as never);

    expect(await service.retentionAnonymise(new Date('2026-01-01'))).toEqual({ deleted: 3 });
  });

  it('purges biometrics on their own window', async () => {
    const repo = new FakeRepo();
    repo.facesPurged = 7;
    const service = new EmployeeService(repo, { provisionStaff: jest.fn() } as never);

    expect(await service.purgeBiometrics(new Date('2026-01-01'))).toEqual({ deleted: 7 });
  });
});
