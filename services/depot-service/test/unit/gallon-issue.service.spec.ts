import { GallonIssueService } from '../../src/application/services/gallon-issue.service';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError } from '../../src/domain/errors';
import {
  CreateGallonIssueData,
  GallonIssueRecord,
  GallonIssueRepository,
  GallonIssueSummary,
} from '../../src/application/ports/gallon-issue.repository';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemoryGallonIssueRepository implements GallonIssueRepository {
  private rows: GallonIssueRecord[] = [];
  private seq = 0;

  async create(data: CreateGallonIssueData): Promise<GallonIssueRecord> {
    const row: GallonIssueRecord = { id: `i${++this.seq}`, createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, page: number, limit: number) {
    const all = this.rows.filter((r) => r.depotId === depotId).reverse();
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async summaryForDepot(depotId: string): Promise<GallonIssueSummary> {
    const all = this.rows.filter((r) => r.depotId === depotId);
    return {
      issues: all.length,
      gallons: all.reduce((s, r) => s + r.quantity, 0),
      depositHeld: all.reduce((s, r) => s + r.depositHeld, 0),
    };
  }
  async networkSummary() {
    const map = new Map<string, { gallons: number; depositHeld: number }>();
    for (const r of this.rows) {
      const e = map.get(r.depotId) ?? { gallons: 0, depositHeld: 0 };
      e.gallons += r.quantity;
      e.depositHeld += r.depositHeld;
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

describe('GallonIssueService', () => {
  let depots: InMemoryDepotRepository;
  let issues: InMemoryGallonIssueRepository;
  let service: GallonIssueService;
  let depotId: string;

  beforeEach(async () => {
    depots = new InMemoryDepotRepository();
    issues = new InMemoryGallonIssueRepository();
    service = new GallonIssueService(issues, depots);
    depotId = (await depots.create(DEPOT)).id;
  });

  it('rejects recording an issue against an unknown depot', async () => {
    await expect(
      service.record('00000000-0000-4000-8000-000000000000', { quantity: 2 }, 'staff-1'),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('records an issue and rolls it into the depot summary', async () => {
    await service.record(depotId, { quantity: 3, depositHeld: 15000 }, 'staff-1');
    await service.record(depotId, { quantity: 1 }, 'staff-1');

    const summary = await service.summary(depotId);
    expect(summary).toEqual({ issues: 2, gallons: 4, depositHeld: 15000 });

    const page = await service.list(depotId, 1, 20);
    expect(page.total).toBe(2);
    expect(page.items[0].quantity).toBe(1); // newest first
  });
});
