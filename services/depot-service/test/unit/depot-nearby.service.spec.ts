import { DepotService } from '../../src/application/services/depot.service';
import { OwnershipType } from '../../src/domain/inventory';
import { CreateDepotData } from '../../src/application/ports/depot.repository';
import { InMemoryDepotRepository } from '../support/fakes';

// Jakarta-ish reference point used as the caller location.
const REF = { lat: -6.2, lng: 106.8 };

const at = (code: string, lat: number, lng: number, serviceRadiusKm: number): CreateDepotData => ({
  code,
  name: `Depot ${code}`,
  ownershipType: OwnershipType.HKP,
  address: 'Jl. Test',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat,
  lng,
  serviceRadiusKm,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: null,
  operatingHours: {},
  holidays: [],
});

describe('DepotService.findNearby', () => {
  let repo: InMemoryDepotRepository;
  let service: DepotService;

  beforeEach(() => {
    repo = new InMemoryDepotRepository();
    service = new DepotService(repo);
  });

  it('orders nearest-first, flags withinService inside vs outside, and skips null-coord depots', async () => {
    // A: on the caller (dist ~0), well inside its 5km radius.
    await service.create(at('A', REF.lat, REF.lng, 5));
    // B: ~2.2km east, inside its 5km radius.
    await service.create(at('B', REF.lat, REF.lng + 0.02, 5));
    // C: ~222km north, OUTSIDE its 5km radius but still returned.
    await service.create(at('C', REF.lat + 2, REF.lng, 5));
    // D: missing coordinates -> must be skipped entirely.
    await service.create(at('D', 0, 0, 5));
    const d = repo.rows.find((r) => r.code === 'D')!;
    d.lat = null as unknown as number;
    d.lng = null as unknown as number;

    const result = await service.findNearby(REF.lat, REF.lng, 10);

    expect(result.map((r) => r.code)).toEqual(['A', 'B', 'C']);
    // ascending distance
    expect(result[0].distanceKm).toBeLessThan(result[1].distanceKm);
    expect(result[1].distanceKm).toBeLessThan(result[2].distanceKm);
    // inside vs outside its own serviceRadiusKm
    expect(result[0].withinService).toBe(true);
    expect(result[1].withinService).toBe(true);
    expect(result[2].withinService).toBe(false);
    // null-coord depot skipped
    expect(result.some((r) => r.code === 'D')).toBe(false);
  });

  it('respects the limit', async () => {
    await service.create(at('A', REF.lat, REF.lng, 5));
    await service.create(at('B', REF.lat, REF.lng + 0.02, 5));
    await service.create(at('C', REF.lat, REF.lng + 0.04, 5));

    const result = await service.findNearby(REF.lat, REF.lng, 2);
    expect(result.map((r) => r.code)).toEqual(['A', 'B']);
  });
});
