import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Department, Prisma } from '../../prisma/generated/client';
import {
  DepartmentRepository,
  DepartmentWrite,
} from '../../src/application/ports/department.repository';
import { DepartmentService } from '../../src/application/services/department.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements DepartmentRepository {
  rows: Department[] = [];
  lastListDepot?: string;
  /** Set to make the next write behave like a Postgres unique-code collision. */
  collide = false;
  private seq = 0;
  async create(data: DepartmentWrite): Promise<Department> {
    this.throwIfColliding();
    const row = { id: `d-${++this.seq}`, ...data } as unknown as Department;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Partial<DepartmentWrite>): Promise<Department> {
    this.throwIfColliding();
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async findById(id: string): Promise<Department | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(depotId?: string): Promise<Department[]> {
    this.lastListDepot = depotId;
    return this.rows;
  }
  private throwIfColliding() {
    if (!this.collide) return;
    throw new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['code'] },
    });
  }
}

function make() {
  const repo = new FakeRepo();
  return { repo, svc: new DepartmentService(repo) };
}

describe('DepartmentService.list', () => {
  it('passes an HR-supplied depot through, forces a manager to its own', async () => {
    const { repo, svc } = make();
    await svc.list(hr, DEPOT_A);
    expect(repo.lastListDepot).toBe(DEPOT_A);
    await svc.list(manager(DEPOT_A));
    expect(repo.lastListDepot).toBe(DEPOT_A);
    await expect(svc.list(manager(DEPOT_A), DEPOT_B)).rejects.toThrow(ForbiddenException);
  });

  it('lists every department when HR supplies no depot', async () => {
    const { repo, svc } = make();
    await svc.list(hr);
    expect(repo.lastListDepot).toBeUndefined();
  });
});

describe('DepartmentService.create', () => {
  it('creates a network-wide department, upper-casing the code', async () => {
    const { svc } = make();
    const d = await svc.create(hr, { code: ' fin ', name: 'Keuangan' });
    expect(d).toMatchObject({ code: 'FIN', depotId: null, active: true });
  });

  it('honours active=false and enforces depot access', async () => {
    const { svc } = make();
    const d = await svc.create(hr, {
      code: 'GDG-A',
      name: 'Gudang',
      depotId: DEPOT_A,
      active: false,
    });
    expect(d).toMatchObject({ depotId: DEPOT_A, active: false });
    await expect(
      svc.create(manager(DEPOT_B), { code: 'X', name: 'x', depotId: DEPOT_A }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('turns a duplicate code into a 409, not a 500', async () => {
    const { repo, svc } = make();
    repo.collide = true;
    await expect(svc.create(hr, { code: 'FIN', name: 'Keuangan' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('rethrows a non-unique database error untouched', async () => {
    const { repo, svc } = make();
    repo.create = async () => {
      throw new Error('connection lost');
    };
    await expect(svc.create(hr, { code: 'FIN', name: 'Keuangan' })).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('DepartmentService.update', () => {
  it('404s on a missing department', async () => {
    const { svc } = make();
    await expect(svc.update(hr, 'nope', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('patches only the provided fields', async () => {
    const { svc } = make();
    const d = await svc.create(hr, { code: 'GDG', name: 'Gudang', depotId: DEPOT_A });
    const u = await svc.update(hr, d.id, {
      code: 'gdg-2',
      name: 'Gudang 2',
      active: false,
      depotId: DEPOT_A,
    });
    expect(u).toMatchObject({ code: 'GDG-2', name: 'Gudang 2', active: false });
  });

  it('patches a single field, leaving the rest untouched', async () => {
    const { svc } = make();
    const d = await svc.create(hr, { code: 'GDG', name: 'Gudang', depotId: DEPOT_A });
    const u = await svc.update(hr, d.id, { name: 'Gudang Utama' });
    expect(u).toMatchObject({ code: 'GDG', name: 'Gudang Utama', active: true });
  });

  it('depot-checks both the existing department and a moved-to depot', async () => {
    const { svc } = make();
    const d = await svc.create(hr, { code: 'GDG', name: 'Gudang', depotId: DEPOT_A });
    await expect(svc.update(manager(DEPOT_B), d.id, { name: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(svc.update(manager(DEPOT_A), d.id, { depotId: DEPOT_B })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('turns a duplicate code into a 409 on update too', async () => {
    const { repo, svc } = make();
    const d = await svc.create(hr, { code: 'GDG', name: 'Gudang' });
    repo.collide = true;
    await expect(svc.update(hr, d.id, { code: 'FIN' })).rejects.toThrow(ConflictException);
  });
});

describe('DepartmentService.remove', () => {
  it('404s on a missing department', async () => {
    const { svc } = make();
    await expect(svc.remove(hr, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('depot-checks then deletes', async () => {
    const { repo, svc } = make();
    const d = await svc.create(hr, { code: 'GDG', name: 'Gudang', depotId: DEPOT_A });
    await expect(svc.remove(manager(DEPOT_B), d.id)).rejects.toThrow(ForbiddenException);
    await svc.remove(manager(DEPOT_A), d.id);
    expect(repo.rows).toHaveLength(0);
  });

  it('lets anyone delete a network-wide department they can reach', async () => {
    const { repo, svc } = make();
    const d = await svc.create(hr, { code: 'FIN', name: 'Keuangan' });
    await svc.remove(manager(DEPOT_A), d.id);
    expect(repo.rows).toHaveLength(0);
  });
});
