import { randomUUID } from 'node:crypto';

import { DepotTargetService } from '../../src/application/services/depot-target.service';
import { DepotTarget } from '../../src/domain/depot-target';
import { DepotNotFoundError } from '../../src/domain/errors';
import {
  DepotTargetRepository,
  UpsertDepotTargetData,
} from '../../src/application/ports/depot-target.repository';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import { InMemoryDepotRepository } from '../support/fakes';

const EDITOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

class InMemoryDepotTargetRepository implements DepotTargetRepository {
  rows: DepotTarget[] = [];

  async findByDepotMonth(depotId: string, month: string): Promise<DepotTarget | null> {
    const r = this.rows.find((x) => x.depotId === depotId && x.month === month);
    return r ? { ...r } : null;
  }

  async upsert(data: UpsertDepotTargetData): Promise<DepotTarget> {
    const existing = this.rows.find((x) => x.depotId === data.depotId && x.month === data.month);
    if (existing) {
      Object.assign(existing, data, { updatedAt: new Date() });
      return { ...existing };
    }
    const now = new Date();
    const row: DepotTarget = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ...row };
  }
}

describe('DepotTargetService', () => {
  let repo: InMemoryDepotTargetRepository;
  let service: DepotTargetService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryDepotTargetRepository();
    service = new DepotTargetService(repo, depotRepo);
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'a',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  const target = (over: Partial<UpsertDepotTargetData> = {}) => ({
    depotId,
    month: '2026-07',
    revenueTargetIdr: 45_000_000,
    ordersTarget: 1200,
    slaTargetPct: 96,
    newCustomersTarget: 80,
    ...over,
  });

  it('returns null when no target is set for the month', async () => {
    expect(await service.get(depotId, '2026-07')).toBeNull();
  });

  it('creates then returns a target', async () => {
    const created = await service.set(target(), EDITOR);
    expect(created.updatedBy).toBe(EDITOR);
    expect(created.revenueTargetIdr).toBe(45_000_000);

    const fetched = await service.get(depotId, '2026-07');
    expect(fetched?.id).toBe(created.id);
  });

  it('upsert overwrites an existing month (same row, new values)', async () => {
    const first = await service.set(target(), EDITOR);
    const second = await service.set(
      target({ revenueTargetIdr: 60_000_000, ordersTarget: 1500 }),
      OTHER,
    );

    expect(second.id).toBe(first.id); // same row, not a duplicate
    expect(second.revenueTargetIdr).toBe(60_000_000);
    expect(second.ordersTarget).toBe(1500);
    expect(second.updatedBy).toBe(OTHER);
    expect(repo.rows).toHaveLength(1);
  });

  it('rejects an unknown depot on set', async () => {
    await expect(
      service.set(target({ depotId: '00000000-0000-0000-0000-000000000000' }), EDITOR),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});
