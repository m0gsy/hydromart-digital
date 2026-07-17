import { GallonReturnService } from '../../src/application/services/gallon-return.service';
import { GallonCondition } from '../../src/domain/gallon-return';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError } from '../../src/domain/errors';
import {
  CreateGallonReturnData,
  GallonReturnRecord,
  GallonReturnRepository,
  GallonReturnSummary,
} from '../../src/application/ports/gallon-return.repository';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemoryGallonReturnRepository implements GallonReturnRepository {
  private rows: GallonReturnRecord[] = [];
  private seq = 0;

  async create(data: CreateGallonReturnData): Promise<GallonReturnRecord> {
    const row: GallonReturnRecord = { id: `r${++this.seq}`, createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, page: number, limit: number) {
    const all = this.rows.filter((r) => r.depotId === depotId).reverse();
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async summaryForDepot(depotId: string): Promise<GallonReturnSummary> {
    const all = this.rows.filter((r) => r.depotId === depotId);
    return {
      returns: all.length,
      gallons: all.reduce((s, r) => s + r.quantity, 0),
      damaged: all.filter((r) => r.condition === GallonCondition.DAMAGED).length,
      depositRefunded: all.reduce((s, r) => s + r.depositRefunded, 0),
    };
  }
  async networkSummary() {
    const map = new Map<string, { gallons: number; depositRefunded: number }>();
    for (const r of this.rows) {
      const e = map.get(r.depotId) ?? { gallons: 0, depositRefunded: 0 };
      e.gallons += r.quantity;
      e.depositRefunded += r.depositRefunded;
      map.set(r.depotId, e);
    }
    return [...map.entries()].map(([depotId, v]) => ({ depotId, ...v }));
  }
}

const DEPOT = {
  code: 'JKT-01',
  name: 'Depot Cikini',
  ownershipType: OwnershipType.HKP,
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat: -6.19,
  lng: 106.84,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: null,
  operatingHours: {},
  holidays: [],
};

describe('GallonReturnService', () => {
  let depots: InMemoryDepotRepository;
  let returns: InMemoryGallonReturnRepository;
  let service: GallonReturnService;
  let depotId: string;

  beforeEach(async () => {
    depots = new InMemoryDepotRepository();
    returns = new InMemoryGallonReturnRepository();
    service = new GallonReturnService(returns, depots);
    depotId = (await depots.create(DEPOT)).id;
  });

  it('rejects recording a return against an unknown depot', async () => {
    await expect(
      service.record('00000000-0000-4000-8000-000000000000', { quantity: 2 }, 'staff-1'),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('records a return and rolls it into the depot summary', async () => {
    await service.record(depotId, { quantity: 3, depositRefunded: 15000 }, 'staff-1');
    await service.record(depotId, { quantity: 1, condition: GallonCondition.DAMAGED }, 'staff-1');

    const summary = await service.summary(depotId);
    expect(summary).toEqual({ returns: 2, gallons: 4, damaged: 1, depositRefunded: 15000 });

    const page = await service.list(depotId, 1, 20);
    expect(page.total).toBe(2);
    expect(page.items[0].condition).toBe(GallonCondition.DAMAGED); // newest first
  });
});
