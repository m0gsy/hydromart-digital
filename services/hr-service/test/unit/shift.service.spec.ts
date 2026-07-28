import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Shift } from '../../prisma/generated/client';
import { ShiftRepository, ShiftWrite } from '../../src/application/ports/shift.repository';
import { ShiftService } from '../../src/application/services/shift.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({
  sub: 'mgr-1',
  role: 'DEPOT_MANAGER' as never,
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
  async list(depotId?: string): Promise<Shift[]> {
    this.lastListDepot = depotId;
    return this.rows;
  }
  async findActiveForDepot(): Promise<Shift | null> {
    return null;
  }
}

function make() {
  const repo = new FakeRepo();
  return { repo, svc: new ShiftService(repo) };
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
