import { DepotService } from '../../src/application/services/depot.service';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError, DuplicateDepotCodeError } from '../../src/domain/errors';
import { CreateDepotData } from '../../src/application/ports/depot.repository';
import { InMemoryDepotRepository } from '../support/fakes';

const base = (over: Partial<CreateDepotData> = {}): CreateDepotData => ({
  code: over.code ?? 'JKT-01',
  name: over.name ?? 'Depot Cikini',
  ownershipType: over.ownershipType ?? OwnershipType.HKP,
  address: 'Jl. Cikini Raya No. 1',
  city: over.city ?? 'Jakarta Pusat',
  province: 'DKI Jakarta',
  lat: -6.1944,
  lng: 106.8412,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: over.ownerId ?? null,
  operatingHours: {},
  holidays: [],
});

describe('DepotService', () => {
  let repo: InMemoryDepotRepository;
  let service: DepotService;

  beforeEach(() => {
    repo = new InMemoryDepotRepository();
    service = new DepotService(repo);
  });

  it('creates a depot and returns it active', async () => {
    const d = await service.create(base());
    expect(d.id).toBeDefined();
    expect(d.active).toBe(true);
    expect(d.deliveryFee).toBe(5000);
  });

  it('rejects a duplicate depot code', async () => {
    await service.create(base({ code: 'DUP' }));
    await expect(service.create(base({ code: 'DUP', name: 'other' }))).rejects.toBeInstanceOf(
      DuplicateDepotCodeError,
    );
  });

  it('browses only active depots, filters by ownership type and search', async () => {
    await service.create(base({ code: 'A1', name: 'Depot Alpha', ownershipType: OwnershipType.HKP }));
    await service.create(base({ code: 'B1', name: 'Depot Beta', ownershipType: OwnershipType.WARALABA }));
    const hidden = await service.create(base({ code: 'C1', name: 'Depot Gamma' }));
    await service.deactivate(hidden.id);

    const all = await service.browse({}, true);
    expect(all.total).toBe(2);

    const waralaba = await service.browse({ ownershipType: OwnershipType.WARALABA }, true);
    expect(waralaba.items).toHaveLength(1);
    expect(waralaba.items[0].code).toBe('B1');

    const searched = await service.browse({ search: 'alpha' }, true);
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0].code).toBe('A1');
  });

  it('rejects updating a code to one already taken by another depot', async () => {
    await service.create(base({ code: 'A1' }));
    const b = await service.create(base({ code: 'B1' }));
    await expect(service.update(b.id, { code: 'A1' })).rejects.toBeInstanceOf(
      DuplicateDepotCodeError,
    );
  });

  it('persists ownerId on create and update', async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const d = await service.create(base({ ownerId: owner }));
    expect(d.ownerId).toBe(owner);

    const next = '22222222-2222-4222-8222-222222222222';
    const updated = await service.update(d.id, { ownerId: next });
    expect(updated.ownerId).toBe(next);
  });

  it('listMine returns only the owner\'s depots (active and inactive), excluding others', async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const active = await service.create(base({ code: 'MINE-A', ownerId: owner }));
    const inactive = await service.create(base({ code: 'MINE-B', ownerId: owner }));
    await service.deactivate(inactive.id);
    await service.create(base({ code: 'OTHER-1', ownerId: other }));
    await service.create(base({ code: 'NOOWNER' }));

    const mine = await service.listMine(owner);
    expect(mine.map((d) => d.id).sort()).toEqual([active.id, inactive.id].sort());
    expect(mine.some((d) => !d.active)).toBe(true);
  });

  it('hides a soft-deleted depot from public get but not admin', async () => {
    const d = await service.create(base());
    await service.deactivate(d.id);
    await expect(service.get(d.id, true)).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.get(d.id, false)).resolves.toMatchObject({ id: d.id, active: false });
  });
});
