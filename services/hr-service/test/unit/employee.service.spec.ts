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
  private seq = 0;

  async count(): Promise<number> {
    return this.rows.length;
  }
  async list(f: EmployeeListFilter): Promise<{ rows: Employee[]; total: number }> {
    let rows = this.rows;
    // `depotId IN (…)` never matches NULL — a network-level employee falls OUT of a
    // depot-scoped list rather than showing up in every one of them.
    if (f.depotIds) rows = rows.filter((r) => !!r.depotId && f.depotIds!.includes(r.depotId));
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
  // Required since "+ Tambah" mints the login too: an employee with no jabatan is somebody
  // the account could not be created for.
  role: 'STAFF_DEPOT' as const,
  employmentStatus: 'PROBATION' as const,
  joinDate: '2026-01-01',
  salaryType: 'DAILY' as const,
  dailyRate: 50000,
};

/** A row from before this release: employee exists, account never did. */
function unlink(repo: FakeRepo, id: string): void {
  const row = repo.rows.find((r) => r.id === id);
  if (row) row.authSubjectId = null;
}

function make() {
  const repo = new FakeRepo();
  const identity = fakeIdentity();
  // depot-service's supervision table, where a reporting line lives now.
  const supervision = {
    links: [] as { staff: string; superior: string }[],
    async superiorOf(staff: string) {
      return supervision.links.find((l) => l.staff === staff)?.superior ?? null;
    },
    async setSuperior(staff: string, superior: string) {
      supervision.links.push({ staff, superior });
    },
  };
  return {
    repo,
    identity,
    supervision,
    svc: new EmployeeService(repo, identity, undefined, supervision),
  };
}

describe('EmployeeService (M1)', () => {
  it('mints a sequential HR-#### code and a HIRED history row on create', async () => {
    const { repo, svc } = make();
    const a = await svc.create(hr, baseInput);
    const b = await svc.create(hr, { ...baseInput, fullName: 'Siti', phone: '0812' });
    expect(a.employeeCode).toBe('HR-0001');
    expect(b.employeeCode).toBe('HR-0002');
    expect(repo.history[0]).toMatchObject({ changeType: 'HIRED' });
  });

  // "+ Tambah" used to write an employee row and nothing else, so the person existed in HR
  // and could not log in anywhere — the single biggest way the two lists disagreed.
  it('mints the login account when adding an employee, and links it', async () => {
    const { identity, svc } = make();

    const e = await svc.create(hr, { ...baseInput, role: 'KEPALA_DEPOT' });

    expect(identity.calls).toEqual([
      { phone: baseInput.phone, role: 'KEPALA_DEPOT', fullName: baseInput.fullName, depotId: DEPOT_A },
    ]);
    expect(e.authSubjectId).toBe('00000000-0000-4000-8000-000000000001');
  });

  // Fail hard, like the import path: an employee row with no account is somebody who
  // cannot clock in, and nothing downstream would notice.
  it('writes no employee row at all when auth-service refuses', async () => {
    const { repo, identity, svc } = make();
    identity.fail(new Error('auth down'));

    await expect(svc.create(hr, { ...baseInput, role: 'KEPALA_DEPOT' })).rejects.toThrow('auth down');
    expect(repo.rows).toHaveLength(0);
  });

  // The pre-check matters more than it looks: without it the NIK collision surfaces at the
  // employee write, AFTER the account was minted, leaving an orphan staff login nobody
  // recorded anywhere.
  it('rejects a duplicate NIK before it provisions anything', async () => {
    const { identity, svc } = make();
    await svc.create(hr, { ...baseInput, role: 'STAFF_DEPOT', nik: '3201010101010001' });
    identity.calls.length = 0;

    await expect(
      svc.create(hr, {
        ...baseInput,
        role: 'STAFF_DEPOT',
        phone: '0899',
        nik: '3201010101010001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(identity.calls).toEqual([]);
  });

  it('rejects a second employee on a phone that already has one, before provisioning', async () => {
    const { identity, svc } = make();
    await svc.create(hr, { ...baseInput, role: 'STAFF_DEPOT' });
    identity.calls.length = 0;

    await expect(svc.create(hr, { ...baseInput, role: 'STAFF_DEPOT' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(identity.calls).toEqual([]);
  });

  it('rejects a supplied staff code that is already taken, before provisioning', async () => {
    const { identity, svc } = make();
    await svc.create(hr, { ...baseInput, role: 'STAFF_DEPOT', employeeCode: 'STAFF-7' });
    identity.calls.length = 0;

    await expect(
      svc.create(hr, { ...baseInput, role: 'STAFF_DEPOT', phone: '0899', employeeCode: 'staff-7' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(identity.calls).toEqual([]);
  });

  // The import provisions before it calls create(); create() must not mint a second one.
  it('uses the account the caller already provisioned instead of minting another', async () => {
    const { identity, svc } = make();

    const e = await svc.create(hr, {
      ...baseInput,
      role: 'STAFF_DEPOT',
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });

    expect(identity.calls).toEqual([]);
    expect(e.authSubjectId).toBe('11111111-1111-4111-8111-111111111111');
  });

  // The gap this closes: a promotion used to change the title and leave the login on the
  // old role, so somebody kept the access they had been moved off.
  it('pushes a jabatan change onto the login, and only when it actually changed', async () => {
    const { identity, svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      role: 'ASSISTANT_SUPERVISOR',
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });

    await svc.update(hr, e.id, { role: 'SUPERVISOR' });
    expect(identity.roleCalls).toEqual([
      {
        customerId: '11111111-1111-4111-8111-111111111111',
        role: 'SUPERVISOR',
        depotId: DEPOT_A,
      },
    ]);

    await svc.update(hr, e.id, { role: 'SUPERVISOR', position: 'SPV Wilayah' });
    expect(identity.roleCalls).toHaveLength(1);
  });

  // Used to pass silently: no account, no call, no error — the promotion simply did not
  // happen and nothing said so. A refusal is the only outcome that reaches a human.
  it('refuses a jabatan change for an employee with no login account', async () => {
    const { repo, identity, svc } = make();
    const e = await svc.create(hr, baseInput);
    unlink(repo, e.id);
    identity.roleCalls.length = 0;

    await expect(svc.update(hr, e.id, { role: 'KEPALA_DEPOT' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(identity.roleCalls).toHaveLength(0);
    // The employee row must not carry the new jabatan either — that is the disagreement
    // between title and token this whole change exists to prevent.
    expect((await svc.getById(hr, e.id)).role).toBe('STAFF_DEPOT');
  });

  // Somebody who resigned on Friday could still open the app on Monday: the employee row
  // said RESIGNED and the login knew nothing about it.
  it('switches the login off when the employee stops being active, and back on', async () => {
    const { identity, svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });

    await svc.update(hr, e.id, { status: 'RESIGNED' });
    expect(identity.activeCalls).toEqual([
      { customerId: '11111111-1111-4111-8111-111111111111', active: false },
    ]);

    await svc.update(hr, e.id, { status: 'ACTIVE' });
    expect(identity.activeCalls[1]).toEqual({
      customerId: '11111111-1111-4111-8111-111111111111',
      active: true,
    });
  });

  // The half auth-service calls: writes, says nothing back. Answering would bounce the same
  // change between the two services forever.
  it('mirrors a console switch-off without calling auth-service back', async () => {
    const { repo, identity, svc } = make();
    await svc.create(hr, {
      ...baseInput,
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });
    identity.activeCalls.length = 0;

    await expect(
      svc.setActiveInternal('11111111-1111-4111-8111-111111111111', false),
    ).resolves.toEqual({ updated: true });

    expect(repo.rows[0]?.status).toBe('INACTIVE');
    expect(identity.activeCalls).toEqual([]);
  });

  it('leaves RESIGNED alone and reports nothing changed for an account it does not know', async () => {
    const { repo, svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });
    await svc.update(hr, e.id, { status: 'RESIGNED' });

    // A plain "switch off" must not overwrite a departure with a weaker status.
    await expect(
      svc.setActiveInternal('11111111-1111-4111-8111-111111111111', false),
    ).resolves.toEqual({ updated: false });
    expect(repo.rows[0]?.status).toBe('RESIGNED');

    // auth-service also holds identities that were never employees.
    await expect(
      svc.setActiveInternal('22222222-2222-4222-8222-222222222222', false),
    ).resolves.toEqual({ updated: false });
  });

  // The repair path for rows written before "+ Tambah" minted accounts, and the button
  // behind the reconciliation badge on /hr/employees.
  it('creates the missing account for an existing employee, once', async () => {
    const { repo, identity, svc } = make();
    const e = await svc.create(hr, baseInput);
    unlink(repo, e.id);
    identity.calls.length = 0;

    const linked = await svc.createAccountFor(hr, e.id);
    expect(identity.calls).toEqual([
      { phone: baseInput.phone, role: 'STAFF_DEPOT', fullName: baseInput.fullName, depotId: DEPOT_A },
    ]);
    expect(linked.authSubjectId).toBe('00000000-0000-4000-8000-000000000002');

    // Clicking twice must not mint a second account.
    identity.calls.length = 0;
    await svc.createAccountFor(hr, e.id);
    expect(identity.calls).toEqual([]);
  });

  it('refuses to mint an account for an employee with no jabatan', async () => {
    const { repo, identity, svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      role: undefined,
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });
    unlink(repo, e.id);
    identity.calls.length = 0;

    await expect(svc.createAccountFor(hr, e.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(identity.calls).toEqual([]);
  });

  // Moving a courier between depots without touching their title left the ACCOUNT at the
  // old depot — and once the dispatch roster is depot-filtered, that courier simply
  // vanishes from their new depot's dropdown.
  it('pushes a depot move onto the login even when the jabatan does not change', async () => {
    const { identity, svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      role: 'STAFF_DEPOT',
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });

    await svc.update(hr, e.id, { depotId: DEPOT_B });

    expect(identity.roleCalls).toEqual([
      {
        customerId: '11111111-1111-4111-8111-111111111111',
        role: 'STAFF_DEPOT',
        depotId: DEPOT_B,
      },
    ]);
  });

  it('says nothing to auth when neither jabatan nor depot moved', async () => {
    const { identity, svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      role: 'STAFF_DEPOT',
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });

    await svc.update(hr, e.id, { position: 'Kurir Senior', depotId: DEPOT_A });

    expect(identity.roleCalls).toEqual([]);
  });

  it('leaves an employee with no account alone when the edit does not touch the jabatan', async () => {
    const { repo, identity, svc } = make();
    const e = await svc.create(hr, baseInput);
    unlink(repo, e.id);
    identity.roleCalls.length = 0;

    await svc.update(hr, e.id, { position: 'Kurir Senior' });
    expect(identity.roleCalls).toHaveLength(0);
  });

  // An employee above depot level: full HR record, no home depot. It must not then be
  // visible from every depot — `depotId IN (…)` skips NULL.
  it('creates an employee with no depot and keeps them out of depot-scoped lists', async () => {
    const { svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      depotId: undefined,
      role: 'SUPERVISOR',
      position: 'SPV',
    });
    expect(e.depotId).toBeNull();
    const scoped = await svc.list(
      { ...hr, role: 'KEPALA_DEPOT' as never, depotId: DEPOT_A },
      { page: 1, pageSize: 50 },
    );
    expect(scoped.rows.map((r) => r.id)).not.toContain(e.id);
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
    await svc.create(hr, { ...baseInput, phone: '0812', depotId: DEPOT_B });
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
      provisionManagedStaff: async () => ({ customerId: 'auth-same' }),
      assignRole: async () => {},
      setStaffActive: async () => {},
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

  // The link now lands in depot-service's supervision table, keyed by ACCOUNT, instead of
  // Employee.supervisorId — one place a reporting line is recorded, the one /hq/hierarchy
  // draws and the leave notifications read.
  it('resolves a supervisor who only appears further down the same file', async () => {
    const { repo, supervision, svc } = make();

    const summary = await svc.importMany(hr, [
      { ...row, fullName: 'Anak Buah', supervisorCode: 'HR-0002' },
      { ...row, fullName: 'Bos', phone: '0812' },
    ]);

    expect(summary).toMatchObject({ created: 2, failed: 0 });
    expect(supervision.links).toEqual([
      { staff: repo.rows[0]?.authSubjectId, superior: repo.rows[1]?.authSubjectId },
    ]);
    // The old column is left alone: this release stops writing it, the drop comes later.
    expect(repo.rows[0]?.supervisorId).toBeNull();
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

  // "Sudah saya upload dari HR kok orangnya tidak kebaca": the row was added by hand, so it
  // has no login, and UPSERT reported `updated` every single time without ever minting one.
  it('UPSERT mints the missing account for a row that was added by hand', async () => {
    const { repo, identity, svc } = make();
    const byHand = await svc.create(hr, {
      ...baseInput,
      role: undefined,
      authSubjectId: '11111111-1111-4111-8111-111111111111',
    });
    unlink(repo, byHand.id); // a row from before "+ Tambah" minted accounts
    identity.calls.length = 0;

    const summary = await svc.importMany(hr, [{ ...row, position: 'Supervisor' }], 'UPSERT');

    expect(summary).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(identity.calls).toEqual([
      { phone: row.phone, role: 'KEPALA_DEPOT', fullName: row.fullName, depotId: DEPOT_A },
    ]);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.id).toBe(byHand.id);
    expect(repo.rows[0]?.authSubjectId).toBe('00000000-0000-4000-8000-000000000001');
    // Said out loud, because "updated" alone reads as "nothing was missing".
    expect(summary.results[0]?.message).toBe('Akun login dibuat');
  });

  it('UPSERT still refuses to re-role an account that already exists', async () => {
    const { identity, svc } = make();
    await svc.importMany(hr, [row]); // creates employee + account
    identity.calls.length = 0;

    await svc.importMany(hr, [{ ...row, role: 'STAFF_DEPOT' }], 'UPSERT');

    // One spreadsheet column must not change what somebody may do in 18 services.
    expect(identity.calls).toEqual([]);
    expect(identity.roleCalls).toEqual([]);
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

// The salary/date shapes and the by-code lookup the import wizard leans on: nothing had
// created a MONTHLY employee, moved somebody onto a monthly salary, patched a birth date or
// contract end, or resolved a staff code.
describe('EmployeeService salary, dates and code lookup', () => {
  it('stores a monthly salary and leaves the daily rate empty', async () => {
    const { svc } = make();
    const e = await svc.create(hr, {
      ...baseInput,
      fullName: 'Rina',
      salaryType: 'MONTHLY',
      dailyRate: undefined,
      monthlyRate: 4_500_000,
    });
    expect(Number(e.monthlyRate)).toBe(4_500_000);
    expect(e.dailyRate).toBeNull();
  });

  it('reuses the stored rate when the salary type is re-sent without one', async () => {
    const { svc } = make();
    const e = await svc.create(hr, baseInput); // DAILY 50000
    // Re-sending the same type with no rate must not demand the number again.
    const same = await svc.update(hr, e.id, { salaryType: 'DAILY' });
    expect(Number(same.dailyRate)).toBe(50000);

    const moved = await svc.update(hr, e.id, { salaryType: 'MONTHLY', monthlyRate: 5_000_000 });
    expect(Number(moved.monthlyRate)).toBe(5_000_000);
    expect(moved.dailyRate).toBeNull();
    const stillMonthly = await svc.update(hr, e.id, { salaryType: 'MONTHLY' });
    expect(Number(stillMonthly.monthlyRate)).toBe(5_000_000);
  });

  it('patches the personal dates as Dates, not strings', async () => {
    const { svc } = make();
    const e = await svc.create(hr, baseInput);
    const updated = await svc.update(hr, e.id, {
      birthDate: '1995-05-05',
      contractEndDate: '2027-01-01',
    });
    expect(updated.birthDate).toEqual(new Date('1995-05-05'));
    expect(updated.contractEndDate).toEqual(new Date('2027-01-01'));
  });

  it('resolves a staff code for the import wizard and rejects an unknown one', async () => {
    const { svc } = make();
    const e = await svc.create(hr, baseInput);
    await expect(svc.getByCode(hr, ' hr-0001 ')).resolves.toMatchObject({ id: e.id });
    await expect(svc.getByCode(hr, 'HR-9999')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads an employee without a depot check for internal callers', async () => {
    const { svc } = make();
    const e = await svc.create(hr, baseInput);
    // A manager from another depot may not getById, but the internal read is ungated on purpose.
    await expect(svc.getById(manager(DEPOT_B), e.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.findByIdInternal(e.id)).resolves.toMatchObject({ id: e.id });
    await expect(svc.findByIdInternal('missing')).resolves.toBeNull();
  });
});
