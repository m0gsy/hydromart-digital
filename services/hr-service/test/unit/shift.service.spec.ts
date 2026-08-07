import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
  /** B2: the same three sources the Prisma repository counts. */
  async countReferences(shiftId: string): Promise<number> {
    const inRotations = this.rotations.filter((r) =>
      Object.values((r.pattern ?? {}) as Record<string, string | null>).includes(shiftId),
    ).length;
    return (
      this.assignments.filter((a) => a.shiftId === shiftId).length +
      this.employeesWithShift.filter((id) => id === shiftId).length +
      inRotations
    );
  }
  /** Employees whose `shiftId` column points at a shift — rung 2 of the precedence. */
  employeesWithShift: string[] = [];

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

  it('renames a shift without touching its hours', async () => {
    const { svc } = make();
    const s = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_A,
    });
    const u = await svc.update(hr, s.id, { name: 'Pagi Awal' });
    expect(u).toMatchObject({ name: 'Pagi Awal', startTime: '08:00', endTime: '16:00' });
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
    // B3: the ids in a pattern have to be real shifts now, so this one is created first.
    const s1 = await shift(svc);
    await svc.createRotation(hr, {
      name: 'Rotasi A',
      pattern: { '0': null, '1': ` ${s1.id} `, '6': '', '9': s1.id, abc: s1.id },
    });
    expect(repo.rotations[0].pattern).toEqual({ '0': null, '1': s1.id, '6': null });
    expect(repo.rotations[0]).toMatchObject({ depotId: null, active: true });
  });

  it('scopes rotations to a depot on read and write', async () => {
    const { svc, repo } = make();
    await svc.listRotations(manager(DEPOT_A));
    expect(repo.lastRotationListDepot).toBe(DEPOT_A);
    // HR with no depot asked for reads network-wide (no filter at all).
    await svc.listRotations(hr);
    expect(repo.lastRotationListDepot).toBeUndefined();
    await expect(
      svc.createRotation(manager(DEPOT_B), { name: 'x', pattern: {}, depotId: DEPOT_A }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('patches a rotation and 404s on a missing one', async () => {
    const { svc } = make();
    const s1 = await shift(svc);
    const s2 = await shift(svc);
    const rot = await svc.createRotation(hr, { name: 'A', pattern: { '1': s1.id } });
    const updated = await svc.updateRotation(hr, rot.id, {
      name: 'B',
      active: false,
      pattern: { '2': s2.id },
      depotId: DEPOT_A,
    });
    expect(updated).toMatchObject({ name: 'B', active: false, pattern: { '2': s2.id } });
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

  it('assigns a rotation, leaving the fixed shift empty', async () => {
    const { svc, repo } = make();
    const s1 = await shift(svc);
    const rot = await svc.createRotation(hr, { name: 'A', pattern: { '1': s1.id } });
    await svc.assign(hr, { employeeId: 'e1', rotationId: rot.id, effectiveFrom: '2026-08-01' });
    expect(repo.assignments[0]).toMatchObject({ rotationId: rot.id, shiftId: null, note: null });
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

/*
 * B2. `ShiftAssignment.shiftId` and `Employee.shiftId` are bare UUID columns with no foreign
 * key, and a rotation names shifts inside its `pattern` JSON — so deleting a shift in use
 * used to succeed and leave every one of those pointing at nothing. `shiftIdForDay` then
 * returns an id `findById` cannot resolve, `assignedShiftStart` becomes null, and the
 * clock-in time drops to another rung of the precedence. Lateness changes — and
 * `lateMinutes` reaches payroll — with no trace and no screen saying so.
 */
describe('ShiftService.remove guards a shift that is still in use (B2)', () => {
  async function withShift() {
    const { repo, svc } = make();
    const shift = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_A,
    });
    return { repo, svc, shift };
  }

  it('refuses when an assignment still points at it, and says to deactivate instead', async () => {
    const { repo, svc, shift } = await withShift();
    await svc.assign(hr, { employeeId: 'e1', shiftId: shift.id, effectiveFrom: '2026-08-03' });

    await expect(svc.remove(hr, shift.id)).rejects.toThrow(ConflictException);
    await expect(svc.remove(hr, shift.id)).rejects.toThrow(/[Nn]onaktifkan/);
    expect(repo.rows).toHaveLength(1);
  });

  it('refuses when a rotation names it in its pattern', async () => {
    const { repo, svc, shift } = await withShift();
    await svc.createRotation(hr, { name: 'A', pattern: { '1': shift.id, '2': null } });

    await expect(svc.remove(hr, shift.id)).rejects.toThrow(ConflictException);
    expect(repo.rows).toHaveLength(1);
  });

  it("refuses when an employee's own shiftId column points at it", async () => {
    const { repo, svc, shift } = await withShift();
    repo.employeesWithShift.push(shift.id);

    await expect(svc.remove(hr, shift.id)).rejects.toThrow(ConflictException);
    expect(repo.rows).toHaveLength(1);
  });

  it('still deletes a shift nothing references', async () => {
    const { repo, svc, shift } = await withShift();
    await svc.remove(hr, shift.id);
    expect(repo.rows).toHaveLength(0);
  });

  // The way out the refusal names has to actually work, or the guard is a dead end.
  it('lets the same shift be deactivated instead', async () => {
    const { svc, shift } = await withShift();
    await svc.assign(hr, { employeeId: 'e1', shiftId: shift.id, effectiveFrom: '2026-08-03' });

    const off = await svc.update(hr, shift.id, { active: false });
    expect(off.active).toBe(false);
  });
});

/*
 * B3. `cleanPattern` only ever tidied the KEYS, while `assign` in the same service DOES
 * validate that a `shiftId` exists. So one write path checked and the other did not, and a
 * rotation could name a random id, another depot's shift, or one already deleted — landing
 * in exactly the dangling state B2 above is about.
 */
describe('ShiftService rotation patterns name real shifts (B3)', () => {
  it('refuses a pattern naming a shift that does not exist', async () => {
    const { repo, svc } = make();
    await expect(
      svc.createRotation(hr, { name: 'A', pattern: { '1': 'no-such-shift' } }),
    ).rejects.toThrow(NotFoundException);
    expect(repo.rotations).toHaveLength(0);
  });

  it("refuses a pattern naming another depot's shift", async () => {
    const { repo, svc } = make();
    const other = await svc.create(hr, {
      name: 'Pagi B',
      startTime: '08:00',
      endTime: '16:00',
      depotId: DEPOT_B,
    });
    await expect(
      svc.createRotation(manager(DEPOT_A), { name: 'A', pattern: { '1': other.id } }),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.rotations).toHaveLength(0);
  });

  it('accepts a network-wide shift, and a day off', async () => {
    const { repo, svc } = make();
    const network = await svc.create(hr, {
      name: 'Pagi',
      startTime: '08:00',
      endTime: '16:00',
    });
    await svc.createRotation(manager(DEPOT_A), {
      name: 'A',
      pattern: { '1': network.id, '2': null },
      depotId: DEPOT_A,
    });
    expect(repo.rotations).toHaveLength(1);
  });

  it('applies the same check when a pattern is edited', async () => {
    const { repo, svc } = make();
    const rot = await svc.createRotation(hr, { name: 'A', pattern: {} });
    await expect(
      svc.updateRotation(hr, rot.id, { pattern: { '3': 'no-such-shift' } }),
    ).rejects.toThrow(NotFoundException);
    expect(repo.rotations[0]?.pattern).toEqual({});
  });
});
