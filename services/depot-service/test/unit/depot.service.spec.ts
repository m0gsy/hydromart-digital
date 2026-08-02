import { DepotService } from '../../src/application/services/depot.service';
import { OwnershipType } from '../../src/domain/inventory';
import {
  DepotNotFoundError,
  DuplicateDepotCodeError,
  FranchiseOwnerRequiredError,
} from '../../src/domain/errors';
import { CreateDepotData } from '../../src/application/ports/depot.repository';
import { InMemoryDepotRepository } from '../support/fakes';

const OWNER = '11111111-1111-4111-8111-111111111111';

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
  paymentBankName: over.paymentBankName,
  paymentBankAccountNumber: over.paymentBankAccountNumber,
  paymentBankAccountHolder: over.paymentBankAccountHolder,
  paymentQrisImageUrl: over.paymentQrisImageUrl,
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
    await service.create(
      base({ code: 'A1', name: 'Depot Alpha', ownershipType: OwnershipType.HKP }),
    );
    await service.create(
      base({
        code: 'B1',
        name: 'Depot Beta',
        ownershipType: OwnershipType.WARALABA,
        ownerId: OWNER,
      }),
    );
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
    const d = await service.create(base({ ownerId: OWNER }));
    expect(d.ownerId).toBe(OWNER);

    const next = '22222222-2222-4222-8222-222222222222';
    const updated = await service.update(d.id, { ownerId: next });
    expect(updated.ownerId).toBe(next);
  });

  // A WARALABA depot with no owner books its revenue and HQ's commission to nobody —
  // order-service credits the ledger by Depot.ownerId. Rejected at the door, both ways in.
  it('refuses to create a franchise depot without an owner', async () => {
    await expect(
      service.create(base({ ownershipType: OwnershipType.WARALABA })),
    ).rejects.toBeInstanceOf(FranchiseOwnerRequiredError);
  });

  it('refuses to turn a depot into a franchise, or orphan one, through update', async () => {
    const central = await service.create(base({ code: 'HKP-1' }));
    await expect(
      service.update(central.id, { ownershipType: OwnershipType.WARALABA }),
    ).rejects.toBeInstanceOf(FranchiseOwnerRequiredError);

    const franchise = await service.create(
      base({ code: 'WLB-1', ownershipType: OwnershipType.WARALABA, ownerId: OWNER }),
    );
    await expect(service.update(franchise.id, { ownerId: null })).rejects.toBeInstanceOf(
      FranchiseOwnerRequiredError,
    );

    // Naming the owner in the same patch is what makes the flip legal.
    const flipped = await service.update(central.id, {
      ownershipType: OwnershipType.WARALABA,
      ownerId: OWNER,
    });
    expect(flipped.ownerId).toBe(OWNER);
    // And a franchise depot handed back to head office may drop its owner in one patch.
    const handedBack = await service.update(franchise.id, {
      ownershipType: OwnershipType.HKP,
      ownerId: null,
    });
    expect(handedBack.ownerId).toBeNull();
  });

  it('round-trips per-depot payment destination fields through create and read', async () => {
    const d = await service.create(
      base({
        paymentBankName: 'BCA',
        paymentBankAccountNumber: '1234567890',
        paymentBankAccountHolder: 'PT Air Segar',
        paymentQrisImageUrl: 'https://cdn.example/qris/jkt-01.png',
      }),
    );
    expect(d.paymentBankName).toBe('BCA');
    expect(d.paymentBankAccountNumber).toBe('1234567890');
    expect(d.paymentBankAccountHolder).toBe('PT Air Segar');
    expect(d.paymentQrisImageUrl).toBe('https://cdn.example/qris/jkt-01.png');

    // Public get (activeOnly) must expose them — the customer pays this depot directly.
    const publicGet = await service.get(d.id, true);
    expect(publicGet.paymentBankName).toBe('BCA');
    expect(publicGet.paymentQrisImageUrl).toBe('https://cdn.example/qris/jkt-01.png');

    const updated = await service.update(d.id, { paymentBankName: 'Mandiri' });
    expect(updated.paymentBankName).toBe('Mandiri');

    // Unset fields default to null, not undefined.
    const bare = await service.create(base({ code: 'BARE-1' }));
    expect(bare.paymentBankName).toBeNull();
    expect(bare.paymentQrisImageUrl).toBeNull();
  });

  it("listMine returns only the owner's depots (active and inactive), excluding others", async () => {
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
