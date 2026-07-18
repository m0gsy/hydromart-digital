import { randomUUID } from 'node:crypto';

import { WholesaleTierService } from '../../src/application/services/wholesale-tier.service';
import { WholesaleTier } from '../../src/domain/wholesale-tier';
import { WholesaleTierNotFoundError } from '../../src/domain/errors';
import {
  CreateWholesaleTierData,
  UpdateWholesaleTierData,
  WholesaleTierRepository,
} from '../../src/application/ports/wholesale-tier.repository';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemoryWholesaleTierRepository implements WholesaleTierRepository {
  rows: WholesaleTier[] = [];

  async create(data: CreateWholesaleTierData): Promise<WholesaleTier> {
    const now = new Date();
    const row: WholesaleTier = { id: randomUUID(), active: true, createdAt: now, updatedAt: now, ...data };
    this.rows.push(row);
    return row;
  }

  async listForDepot(depotId: string): Promise<WholesaleTier[]> {
    return this.rows.filter((r) => r.depotId === depotId).sort((a, b) => a.minQty - b.minQty);
  }

  async findById(id: string): Promise<WholesaleTier | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async update(id: string, data: UpdateWholesaleTierData): Promise<WholesaleTier> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }

  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}

const UNKNOWN = '00000000-0000-0000-0000-000000000000';

describe('WholesaleTierService', () => {
  let repo: InMemoryWholesaleTierRepository;
  let service: WholesaleTierService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryWholesaleTierRepository();
    service = new WholesaleTierService(repo, depotRepo);
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

  const seed = () => service.create({ depotId, label: 'Grosir 20+', minQty: 20, priceIdr: 16_000 });

  it('updates mutates a tier', async () => {
    const tier = await seed();
    const updated = await service.update(tier.id, { priceIdr: 15_000, active: false });
    expect(updated.priceIdr).toBe(15_000);
    expect(updated.active).toBe(false);
    expect((await repo.findById(tier.id))!.priceIdr).toBe(15_000);
  });

  it('delete removes a tier', async () => {
    const tier = await seed();
    await service.remove(tier.id);
    expect(await repo.findById(tier.id)).toBeNull();
    expect(await service.list(depotId)).toHaveLength(0);
  });

  it('throws NotFound updating or deleting a missing tier', async () => {
    await expect(service.update(UNKNOWN, { priceIdr: 1 })).rejects.toBeInstanceOf(
      WholesaleTierNotFoundError,
    );
    await expect(service.remove(UNKNOWN)).rejects.toBeInstanceOf(WholesaleTierNotFoundError);
  });
});
