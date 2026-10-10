import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee, Prisma } from '../../prisma/generated/client';
import type { DepotMoveWrite } from '../../src/application/ports/employee.repository';
import { EmployeeService } from '../../src/application/services/employee.service';
import { EmployeePrismaRepository } from '../../src/infrastructure/prisma/employee.prisma.repository';
import { fakeIdentity } from './support/identity';

const GALAKSI = '11111111-1111-1111-1111-111111111111';
const PEKAYON = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

/** Records every write, including the ledger move the service hands the repository. */
class RecordingRepo {
  rows: Employee[] = [];
  updates: { id: string; data: Prisma.EmployeeUpdateInput; move?: DepotMoveWrite }[] = [];
  creates: Prisma.EmployeeCreateInput[] = [];
  async count() {
    return this.rows.length;
  }
  async create(data: Prisma.EmployeeCreateInput) {
    this.creates.push(data);
    const row = { id: 'emp-new', ...data } as unknown as Employee;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Prisma.EmployeeUpdateInput, _history: unknown, move?: DepotMoveWrite) {
    this.updates.push({ id, data, move });
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByAuthSubjectId(sub: string) {
    return this.rows.find((r) => r.authSubjectId === sub) ?? null;
  }
  async findConflicting() {
    return null;
  }
}

function make(depotId: string | null = GALAKSI) {
  const repo = new RecordingRepo();
  repo.rows.push({
    id: 'emp-1',
    employeeCode: 'HR-0001',
    fullName: 'Budi',
    phone: '0811',
    depotId,
    homeDepotId: depotId,
    role: 'STAFF_DEPOT',
    authSubjectId: 'acct-1',
    departmentId: null,
    status: 'ACTIVE',
    joinDate: new Date('2026-01-01T00:00:00.000Z'),
    salaryType: 'DAILY',
    dailyRate: null,
    monthlyRate: null,
  } as unknown as Employee);
  const svc = new EmployeeService(repo as never, fakeIdentity());
  return { repo, svc };
}

describe('the single depot write gate', () => {
  it('a permanent depot change writes the ledger move and the new home in the same update', async () => {
    const { repo, svc } = make();
    await svc.update(hr, 'emp-1', { depotId: PEKAYON });
    const [write] = repo.updates;
    expect(write.data.depotId).toBe(PEKAYON);
    expect(write.data.homeDepotId).toBe(PEKAYON);
    expect(write.move).toMatchObject({
      fromDepotId: GALAKSI,
      toDepotId: PEKAYON,
      kind: 'PERMANENT',
      createdBy: null, // 'hr-1' is not a uuid, so it is recorded as null
    });
    // Effective date is a whole local day stored as UTC midnight.
    expect(write.move!.effectiveDate.toISOString()).toMatch(/T00:00:00\.000Z$/);
  });

  it('records no move when the depot is untouched or re-saved unchanged', async () => {
    const { repo, svc } = make();
    await svc.update(hr, 'emp-1', { fullName: 'Budi S' });
    await svc.update(hr, 'emp-1', { depotId: GALAKSI });
    for (const u of repo.updates) {
      expect(u.move).toBeUndefined();
      expect(u.data).not.toHaveProperty('homeDepotId');
    }
  });

  it('a console transfer (setDepotInternal) goes through the same gate', async () => {
    const { repo, svc } = make();
    await svc.setDepotInternal('acct-1', PEKAYON);
    expect(repo.updates[0].data).toMatchObject({ depotId: PEKAYON, homeDepotId: PEKAYON });
    expect(repo.updates[0].move).toMatchObject({ fromDepotId: GALAKSI, toDepotId: PEKAYON });
  });

  it('a network-wide employee (null depot) can be moved to a depot, and back out', async () => {
    const { repo, svc } = make(null);
    await svc.update(hr, 'emp-1', { depotId: PEKAYON });
    expect(repo.updates[0].move).toMatchObject({ fromDepotId: null, toDepotId: PEKAYON });
  });

  it('a new employee is born with home = depot', async () => {
    const { repo, svc } = make();
    await svc.create(hr, {
      fullName: 'Sari',
      phone: '0822',
      depotId: PEKAYON,
      position: 'Kurir',
      role: 'STAFF_DEPOT',
      employmentStatus: 'PROBATION',
      joinDate: '2026-01-01',
      salaryType: 'DAILY',
      dailyRate: 50000,
      authSubjectId: 'acct-2',
    });
    expect(repo.creates[0]).toMatchObject({ depotId: PEKAYON, homeDepotId: PEKAYON });
  });
});

describe('the repository refuses a depot write that skipped the gate', () => {
  function repoWith(prisma: unknown) {
    return new EmployeePrismaRepository(prisma as never);
  }

  it('update(depotId) without a move is rejected before it reaches the database', () => {
    const update = jest.fn();
    const repo = repoWith({ employee: { update } });
    expect(() => repo.update('e1', { depotId: PEKAYON }, [])).toThrow(/depot/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('update(homeDepotId) without a move is rejected too', () => {
    const repo = repoWith({ employee: { update: jest.fn() } });
    expect(() => repo.update('e1', { homeDepotId: PEKAYON }, [])).toThrow(/depot/i);
  });

  it('update with a move writes the ledger row nested in the same statement', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repo = repoWith({ employee: { update } });
    const move: DepotMoveWrite = {
      fromDepotId: GALAKSI,
      toDepotId: PEKAYON,
      effectiveDate: new Date('2026-10-16T00:00:00.000Z'),
      kind: 'PERMANENT',
      createdBy: null,
    };
    await repo.update('e1', { depotId: PEKAYON, homeDepotId: PEKAYON }, [], move);
    const arg = update.mock.calls[0][0];
    expect(arg.data.depotMoves).toEqual({ create: move });
  });

  it('update with extras nests the assignment state and re-homes pending kasbon and leave', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repo = repoWith({ employee: { update } });
    const move: DepotMoveWrite = {
      fromDepotId: GALAKSI,
      toDepotId: PEKAYON,
      effectiveDate: new Date('2026-10-16T00:00:00.000Z'),
      kind: 'LOAN_START',
      createdBy: null,
    };
    await repo.update('e1', { depotId: PEKAYON }, [], move, {
      assignment: { id: 'as-1', data: { status: 'ACTIVE' } },
      movePendingRequestsTo: PEKAYON,
    });
    const data = update.mock.calls[0][0].data;
    expect(data.depotAssignments).toEqual({ update: { where: { id: 'as-1' }, data: { status: 'ACTIVE' } } });
    expect(data.loanRequests.updateMany).toEqual({ where: { status: 'PENDING' }, data: { depotId: PEKAYON } });
    expect(data.leaveRequests.updateMany.where.status.in).toEqual(['PENDING_MANAGER', 'PENDING_HR']);
  });

  it('an assignment-only update (already at the destination) needs no ledger move', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repo = repoWith({ employee: { update } });
    await repo.update('e1', {}, [], undefined, { assignment: { id: 'as-1', data: { status: 'DONE' } } });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('create with a depot but a different home is rejected', () => {
    const repo = repoWith({ employee: { create: jest.fn() } });
    expect(() => repo.create({ depotId: PEKAYON, homeDepotId: GALAKSI } as never)).toThrow(/depot/i);
    expect(() => repo.create({ depotId: PEKAYON } as never)).toThrow(/depot/i);
  });

  it('create with no depot, or with home = depot, is fine', async () => {
    const create = jest.fn().mockResolvedValue({});
    const repo = repoWith({ employee: { create } });
    await repo.create({ depotId: null } as never);
    await repo.create({ depotId: PEKAYON, homeDepotId: PEKAYON } as never);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('no other code writes employees directly', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
    });
  }
  const SRC = join(__dirname, '..', '..', 'src');

  it('only the employee repository calls prisma.employee write methods', () => {
    const writers = walk(SRC)
      .filter((f) => /\.employee\.(update|updateMany|create|createMany|upsert)\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split(sep).join('/'));
    expect(writers).toEqual(['infrastructure/prisma/employee.prisma.repository.ts']);
  });

  it('only the employee service, the applier and the two repositories know the depot ledger', () => {
    const users = walk(SRC)
      .filter((f) => /depotMoves|employeeDepotMove|DepotMoveWrite/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .sort();
    expect(users).toEqual([
      'application/ports/employee.repository.ts',
      // The sweep that applies assignments writes the ledger through the same repository door.
      'application/services/depot-assignment-applier.service.ts',
      'application/services/employee.service.ts',
      // Reads the ledger back (never writes it) so attendance can ask "which depot that day".
      'infrastructure/prisma/depot-assignment.prisma.repository.ts',
      'infrastructure/prisma/employee.prisma.repository.ts',
    ]);
  });
});
