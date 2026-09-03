import { DepotConfigService } from '../../src/config/depot-config.service';
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

const GALLON_DEPOSIT_IDR = 20000;
/** I1: the deposit is derived here, never supplied by the caller — so the rate is a stub. */
const configStub = { gallonDepositIdr: () => GALLON_DEPOSIT_IDR } as unknown as DepotConfigService;

describe('GallonIssueService', () => {
  let depots: InMemoryDepotRepository;
  let issues: InMemoryGallonIssueRepository;
  let service: GallonIssueService;
  let depotId: string;

  beforeEach(async () => {
    depots = new InMemoryDepotRepository();
    issues = new InMemoryGallonIssueRepository();
    service = new GallonIssueService(issues, depots, configStub);
    depotId = (await depots.create(DEPOT)).id;
  });

  /**
   * I1: fulfilment books the empties a delivery carried out. The deposit is DERIVED here
   * from the depot's own rate and never supplied by the caller — a caller that could name
   * the figure could book money the depot never charged, and this ledger is what every
   * later refund is measured against.
   */
  it('derives the deposit from the depot rate when fulfilment books an issue (I1)', async () => {
    const rec = await service.recordFromOrder(
      depotId,
      { orderId: 'o-1', customerId: 'cu-1', quantity: 3 },
      'order-service',
    );
    expect(rec.depositHeld).toBe(3 * GALLON_DEPOSIT_IDR);
    expect(rec.orderId).toBe('o-1');
    expect(rec.customerId).toBe('cu-1');
    expect(rec.actorId).toBe('order-service');
  });

  // An anonymous counter sale still takes empties off the shelf, so the gallons are booked
  // with nobody named. The depot's outstanding balance has to say so either way.
  it('books an anonymous fulfilment issue with no customer (I1)', async () => {
    const rec = await service.recordFromOrder(
      depotId,
      { orderId: 'o-2', quantity: 1 },
      'order-service',
    );
    expect(rec.customerId).toBeNull();
    expect(rec.depositHeld).toBe(GALLON_DEPOSIT_IDR);
  });

  it('rejects a fulfilment issue against an unknown depot (I1)', async () => {
    await expect(
      service.recordFromOrder(
        '00000000-0000-4000-8000-000000000000',
        { orderId: 'o-3', quantity: 1 },
        'order-service',
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
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
