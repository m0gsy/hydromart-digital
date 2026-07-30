import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Shift, ShiftAssignment, ShiftRotation } from '../../prisma/generated/client';
import {
  AssignmentWrite,
  RotationWrite,
  ShiftRepository,
  ShiftWrite,
} from '../../src/application/ports/shift.repository';
import { EmployeeService } from '../../src/application/services/employee.service';
import { ShiftService } from '../../src/application/services/shift.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'MANAGER' as never,
  phone: '0800',
  depotId,
});

class FakeRepo implements ShiftRepository {
  rows: Shift[] = [];
  lastListDepot?: string;
  private seq = 0;
  async create(data: ShiftWrite): Promise<Shift> {
    const row = { id: `s-${++this.seq}`, ...data } as unknown as Shift;
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: Partial<ShiftWrite>): Promise<Shift> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async findById(id: string): Promise<Shift | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(depotId?: readonly string[]): Promise<Shift[]> {
    this.lastListDepot = depotId?.[0];
    return this.rows;
  }
  async findActiveForDepot(): Promise<Shift | null> {
    return null;
  }

  // ── rotations & assignments (C3) ──────────────────────────────────
  rotations: ShiftRotation[] = [];
  assignments: ShiftAssignment[] = [];
  lastRotationListDepot?: string;

  async createRotation(data: RotationWrite): Promise<ShiftRotation> {
    const row = { id: `rot-${this.rotations.length + 1}`, ...data } as unknown as ShiftRotation;
    this.rotations.push(row);
    return row;
  }
  async updateRotation(id: string, data: Partial<RotationWrite>): Promise<ShiftRotation> {
    const row = this.rotations.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async findRotationById(id: string): Promise<ShiftRotation | null> {
    return this.rotations.find((r) => r.id === id) ?? null;
  }
  async listRotations(depotId?: readonly string[]): Promise<ShiftRotation[]> {
    this.lastRotationListDepot = depotId?.[0];
    return this.rotations;
  }
  async assign(data: AssignmentWrite): Promise<ShiftAssignment> {
    const row = { id: `as-${this.assignments.length + 1}`, ...data } as unknown as ShiftAssignment;
    this.assignments.push(row);
    return row;
  }
  async listAssignmentsUpTo(employeeId: string, onDate: Date): Promise<ShiftAssignment[]> {
    return this.assignments.filter(
      (a) => a.employeeId === employeeId && a.effectiveFrom.getTime() <= onDate.getTime(),
    );
  }
  async listAssignments(employeeId: string): Promise<ShiftAssignment[]> {
    return this.assignments.filter((a) => a.employeeId === employeeId);
  }
}

function make() {
  const repo = new FakeRepo();
  const employees = {
    getById: jest.fn(async (_u: AuthenticatedUser, id: string) => ({ id, depotId: DEPOT_A })),
  } as unknown as EmployeeService;
  return { repo, employees, svc: new ShiftService(repo, employees) };
}

describe('ShiftService.list', () => {
  it('passes an HR-supplied depot through, forces a manager to its own', async () => {
    const { repo, svc } = make();
    await svc.list(hr, DEPOT_A);
    expect(repo.lastListDepot).toBe(DEPOT_A);
    await svc.list(manager(DEPOT_A));
    expect(repo.lastListDepot).toBe(DEPOT_A);
    await expect(svc.list(manager(DEPOT_A), DEPOT_B)).rejects.toThrow(ForbiddenException);
  });

  it('lists network-wide (undefined filter) when HR supplies no depot', async () => {
    const { repo, svc } = make();
    await svc.list(hr);
    expect(repo.lastListDepot).toBeUndefined();
  });
});

describe('ShiftService.create', () => {
  it('creates a global shift (default active=true)', async () => {
    const { svc } = make();
    const s = await svc.create(hr, { name: 'Pagi', startTime: '08:00', endTime: '16:00' });
    expect(s).toMatchObject({ depotId: null, active: true });
  });

  it('honours active=false and enforces depot access', async () => {
    const { svc } = make();
    const s = await svc.create(hr, {
      name: 'Malam',
      startTime: '22:00',
      endTime: '06:00',
      active: false,
      depotId: DEPOT_A,
    });
    expect(s).toMatchObject({ depotId: DEPOT_A, active: false });
    await expect(
      svc.create(manager(DEPOT_B), {
        name: 'x',
        startTime: '08:00',
        endTime: '16:00',
        depotId: DEPOT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ShiftService.update', () => {
  it('404s on a missing shift', async () => {
    const { svc } = make();
    await expect(svc.update(hr, 'nope', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('patches only the provided fields', async () => {
    const { svc } = make();
    const s = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_A,
    });
    const u = await svc.update(hr, s.id, {
      name: 'Pagi 2',
      startTime: '07:30',
      endTime: '15:30',
      active: false,
      depotId: DEPOT_A,
    });
    expect(u).toMatchObject({
      name: 'Pagi 2',
      startTime: '07:30',
      endTime: '15:30',
      active: false,
    });
  });

  it('patches a single field, leaving the rest untouched', async () => {
    const { svc } = make();
    const s = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_A,
    });
    const u = await svc.update(hr, s.id, { startTime: '09:00' });
    expect(u).toMatchObject({ name: 'Pagi', startTime: '09:00', endTime: '16:00', active: true });
  });

  it('depot-checks both the existing shift and a moved-to depot', async () => {
    const { svc } = make();
    const s = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_A,
    });
    await expect(svc.update(manager(DEPOT_B), s.id, { name: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(svc.update(manager(DEPOT_A), s.id, { depotId: DEPOT_B })).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('ShiftService rotations & assignments (C3)', () => {
  const shift = (svc: ShiftService) =>
    svc.create(hr, { name: 'Pagi', startTime: '08:00', endTime: '16:00' });

  it('keeps only weekday keys and turns a blank shift id into a day off', async () => {
    const { svc, repo } = make();
    await svc.createRotation(hr, {
      name: 'Rotasi A',
      pattern: { '0': null, '1': ' s-1 ', '6': '', '9': 's-1', abc: 's-1' },
    });
    expect(repo.rotations[0].pattern).toEqual({ '0': null, '1': 's-1', '6': null });
    expect(repo.rotations[0]).toMatchObject({ depotId: null, active: true });
  });

  it('scopes rotations to a depot on read and write', async () => {
    const { svc, repo } = make();
    await svc.listRotations(manager(DEPOT_A));
    expect(repo.lastRotationListDepot).toBe(DEPOT_A);
    await expect(
      svc.createRotation(manager(DEPOT_B), { name: 'x', pattern: {}, depotId: DEPOT_A }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('patches a rotation and 404s on a missing one', async () => {
    const { svc } = make();
    const rot = await svc.createRotation(hr, { name: 'A', pattern: { '1': 's-1' } });
    const updated = await svc.updateRotation(hr, rot.id, {
      name: 'B',
      active: false,
      pattern: { '2': 's-2' },
      depotId: DEPOT_A,
    });
    expect(updated).toMatchObject({ name: 'B', active: false, pattern: { '2': 's-2' } });
    // A patch with nothing in it is a no-op, not a wipe.
    expect(await svc.updateRotation(hr, rot.id, {})).toMatchObject({ name: 'B' });
    await expect(svc.updateRotation(hr, 'ghost', { name: 'x' })).rejects.toThrow(NotFoundException);
    await expect(svc.updateRotation(manager(DEPOT_B), rot.id, { name: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('assigns an employee to a shift from a date and keeps the old row', async () => {
    const { svc, repo, employees } = make();
    const s = await shift(svc);
    await svc.assign(hr, { employeeId: 'e1', shiftId: s.id, effectiveFrom: '2026-08-01' });
    await svc.assign(hr, {
      employeeId: 'e1',
      shiftId: s.id,
      effectiveFrom: '2026-09-01',
      note: 'pindah gudang',
    });
    expect(employees.getById).toHaveBeenCalledWith(hr, 'e1');
    expect(repo.assignments).toHaveLength(2);
    expect(repo.assignments[0].effectiveFrom).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(repo.assignments[1]).toMatchObject({ note: 'pindah gudang', createdBy: 'hr-1' });
    expect(await svc.listAssignments(hr, 'e1')).toHaveLength(2);
  });

  it('demands exactly one of shiftId / rotationId', async () => {
    const { svc } = make();
    const s = await shift(svc);
    const rot = await svc.createRotation(hr, { name: 'A', pattern: {} });
    await expect(svc.assign(hr, { employeeId: 'e1', effectiveFrom: '2026-08-01' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      svc.assign(hr, {
        employeeId: 'e1',
        shiftId: s.id,
        rotationId: rot.id,
        effectiveFrom: '2026-08-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when the shift or rotation being assigned does not exist', async () => {
    const { svc } = make();
    await expect(
      svc.assign(hr, { employeeId: 'e1', shiftId: 'ghost', effectiveFrom: '2026-08-01' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.assign(hr, { employeeId: 'e1', rotationId: 'ghost', effectiveFrom: '2026-08-01' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an unparseable effectiveFrom', async () => {
    const { svc } = make();
    const s = await shift(svc);
    await expect(
      svc.assign(hr, { employeeId: 'e1', shiftId: s.id, effectiveFrom: 'besok-pagi' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ShiftService.remove', () => {
  it('404s on a missing shift', async () => {
    const { svc } = make();
    await expect(svc.remove(hr, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('depot-checks then deletes', async () => {
    const { repo, svc } = make();
    const s = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_A,
    });
    await expect(svc.remove(manager(DEPOT_B), s.id)).rejects.toThrow(ForbiddenException);
    await svc.remove(manager(DEPOT_A), s.id);
    expect(repo.rows).toHaveLength(0);
  });
});
