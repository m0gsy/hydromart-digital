import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, EmploymentHistory, Prisma } from '../../prisma/generated/client';
import {
  EmployeeRepository,
  EmployeeListFilter,
} from '../../src/application/ports/employee.repository';
import { EmployeeService } from '../../src/application/services/employee.service';
import { fakeIdentity } from './support/identity';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

function p2002(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'x',
    meta: { target: [target] },
  });
}

class FakeRepo implements EmployeeRepository {
  /** HQ deleted the account behind this employee (Fase 6). */
  anonymisedAccounts: string[] = [];
  async anonymiseByAuthSubjectId(authSubjectId: string): Promise<number> {
    this.anonymisedAccounts.push(authSubjectId);
    return 1;
  }

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
  /** targets to throw on successive create() calls; undefined = succeed. */
  throwOnCreate: (string | undefined)[] = [];
  private seq = 0;
  private createCalls = 0;

  async count(): Promise<number> {
    return this.rows.length;
  }
  async list(f: EmployeeListFilter): Promise<{ rows: Employee[]; total: number }> {
    return { rows: this.rows.slice(f.skip, f.skip + f.take), total: this.rows.length };
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
    authSubjectId: string,
    phone: string,
  ): Promise<{ linked: Employee | null; oldestByPhone: Employee | null }> {
    return {
      linked: await this.findByAuthSubjectId(authSubjectId),
      oldestByPhone: await this.findByPhone(phone),
    };
  }
  async listHistory(_employeeId: string): Promise<EmploymentHistory[]> {
    // Fake: HIRED rows are written without an employeeId (WithoutEmployeeInput), so return all.
    return this.history.map((h) => h as unknown as EmploymentHistory);
  }
  async create(
    data: Prisma.EmployeeCreateInput,
    history?: Prisma.EmploymentHistoryCreateWithoutEmployeeInput,
  ): Promise<Employee> {
    const target = this.throwOnCreate[this.createCalls++];
    if (target) throw p2002(target);
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
  // "+ Tambah" mints the login too, so a new employee always carries a jabatan.
  role: 'STAFF_DEPOT' as const,
  employmentStatus: 'PROBATION' as const,
  joinDate: '2026-01-01',
  salaryType: 'DAILY' as const,
  dailyRate: 50000,
};

describe('EmployeeService self / history', () => {
  it('getSelf resolves the linked employee', async () => {
    const repo = new FakeRepo();
    const svc = new EmployeeService(repo, fakeIdentity());
    const e = await svc.create(hr, { ...baseInput, authSubjectId: hr.sub });
    await expect(svc.getSelf(hr)).resolves.toMatchObject({ id: e.id });
  });

  it('getHistory returns the row’s history after the depot check', async () => {
    const repo = new FakeRepo();
    const svc = new EmployeeService(repo, fakeIdentity());
    const e = await svc.create(hr, baseInput);
    const hist = await svc.getHistory(hr, e.id);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ changeType: 'HIRED' });
    await expect(svc.getHistory(hr, 'nope')).rejects.toThrow(NotFoundException);
  });
});

describe('EmployeeService.create collisions', () => {
  it('retries the sequential code on an employeeCode unique violation', async () => {
    const repo = new FakeRepo();
    repo.throwOnCreate = ['employeeCode']; // first attempt collides, second succeeds
    const svc = new EmployeeService(repo, fakeIdentity());
    const e = await svc.create(hr, baseInput);
    expect(e.employeeCode).toBe('HR-0002'); // attempt index 1 → count(0)+1+1
  });

  it('maps an authSubjectId unique violation to a friendly 400', async () => {
    const repo = new FakeRepo();
    repo.throwOnCreate = ['authSubjectId'];
    const svc = new EmployeeService(repo, fakeIdentity());
    await expect(svc.create(hr, { ...baseInput, authSubjectId: 'dup' })).rejects.toThrow(
      /tertaut ke karyawan lain/,
    );
  });

  it('rethrows an unrelated error', async () => {
    const repo = new FakeRepo();
    repo.throwOnCreate = ['someOtherField'];
    const svc = new EmployeeService(repo, fakeIdentity());
    await expect(svc.create(hr, baseInput)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});

describe('EmployeeService.update salary + depot move', () => {
  it('re-shapes rates on a salaryType switch and moves depot', async () => {
    const repo = new FakeRepo();
    const svc = new EmployeeService(repo, fakeIdentity());
    const e = await svc.create(hr, baseInput); // DAILY
    const updated = await svc.update(hr, e.id, {
      salaryType: 'MONTHLY',
      monthlyRate: 4_000_000,
      depotId: DEPOT_A,
    });
    expect(updated.salaryType).toBe('MONTHLY');
    expect(Number(updated.monthlyRate)).toBe(4_000_000);
    expect(updated.dailyRate).toBeNull();
  });

  it('rejects a switch to MONTHLY without a monthlyRate', async () => {
    const repo = new FakeRepo();
    const svc = new EmployeeService(repo, fakeIdentity());
    const e = await svc.create(hr, baseInput);
    await expect(svc.update(hr, e.id, { salaryType: 'MONTHLY' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
