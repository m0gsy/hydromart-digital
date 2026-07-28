import { GallonIssueService } from '../../src/application/services/gallon-issue.service';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError } from '../../src/domain/errors';
import { InMemoryDepotRepository, InMemoryGallonIssueRepository } from '../support/fakes';

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
