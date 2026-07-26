import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Holiday } from '../../prisma/generated/client';
import { HolidayRepository } from '../../src/application/ports/holiday.repository';
import { HolidayService } from '../../src/application/services/holiday.service';

const DEPOT_A = '11111111-1111-1111-1111-111111111111';
const DEPOT_B = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const manager = (depotId: string): AuthenticatedUser => ({ sub: 'mgr-1', role: 'DEPOT_MANAGER' as never, phone: '0800', depotId });

class FakeRepo implements HolidayRepository {
  rows: Holiday[] = [];
  lastFilter?: { depotId?: string; from?: Date; to?: Date };
  private seq = 0;
  async create(data: { date: Date; name: string; depotId: string | null }): Promise<Holiday> {
    const row = { id: `h-${++this.seq}`, ...data } as unknown as Holiday;
    this.rows.push(row);
    return row;
  }
  async list(filter: { depotId?: string; from?: Date; to?: Date }): Promise<Holiday[]> {
    this.lastFilter = filter;
    return this.rows;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async findById(id: string): Promise<Holiday | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listDates(): Promise<string[]> {
    return [];
  }
}

function make() {
  const repo = new FakeRepo();
  return { repo, svc: new HolidayService(repo) };
}

describe('HolidayService.list', () => {
  it('passes HR-supplied filters through, parsing dates', async () => {
    const { repo, svc } = make();
    await svc.list(hr, { depotId: DEPOT_A, from: '2026-07-01', to: '2026-07-31' });
    expect(repo.lastFilter?.depotId).toBe(DEPOT_A);
    expect(repo.lastFilter?.from).toEqual(new Date('2026-07-01'));
    expect(repo.lastFilter?.to).toEqual(new Date('2026-07-31'));
  });

  it('leaves dates undefined when omitted', async () => {
    const { repo, svc } = make();
    await svc.list(hr, {});
    expect(repo.lastFilter).toEqual({ depotId: undefined, from: undefined, to: undefined });
  });

  it('forces a depot-locked role onto its own depot', async () => {
    const { repo, svc } = make();
    await svc.list(manager(DEPOT_A), {});
    expect(repo.lastFilter?.depotId).toBe(DEPOT_A);
    await expect(svc.list(manager(DEPOT_A), { depotId: DEPOT_B })).rejects.toThrow(ForbiddenException);
  });
});

describe('HolidayService.create', () => {
  it('creates a national holiday (no depot check)', async () => {
    const { svc } = make();
    const h = await svc.create(hr, { date: '2026-08-17', name: 'HUT RI' });
    expect(h).toMatchObject({ depotId: null, name: 'HUT RI' });
    expect(h.date).toEqual(new Date('2026-08-17'));
  });

  it('enforces depot access for a depot-scoped holiday', async () => {
    const { svc } = make();
    await expect(svc.create(manager(DEPOT_B), { date: '2026-08-17', name: 'x', depotId: DEPOT_A })).rejects.toThrow(ForbiddenException);
    await expect(svc.create(manager(DEPOT_A), { date: '2026-08-17', name: 'x', depotId: DEPOT_A })).resolves.toMatchObject({ depotId: DEPOT_A });
  });
});

describe('HolidayService.remove', () => {
  it('404s on a missing holiday', async () => {
    const { svc } = make();
    await expect(svc.remove(hr, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('removes a national holiday for HR', async () => {
    const { repo, svc } = make();
    const h = await svc.create(hr, { date: '2026-08-17', name: 'HUT RI' });
    await svc.remove(hr, h.id);
    expect(repo.rows).toHaveLength(0);
  });

  it('depot-checks a depot-scoped holiday before deleting', async () => {
    const { repo, svc } = make();
    const h = await svc.create(hr, { date: '2026-08-17', name: 'x', depotId: DEPOT_A });
    await expect(svc.remove(manager(DEPOT_B), h.id)).rejects.toThrow(ForbiddenException);
    await svc.remove(manager(DEPOT_A), h.id);
    expect(repo.rows).toHaveLength(0);
  });
});
