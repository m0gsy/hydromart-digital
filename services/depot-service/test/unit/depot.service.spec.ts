import { DepotService } from '../../src/application/services/depot.service';
import { OwnershipType } from '../../src/domain/inventory';
import {
  DepotNotFoundError,
  DuplicateDepotCodeError,
  FranchiseOwnerRequiredError,
  InvalidOwnerSharesError,
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
  owners: over.owners,
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

  it('browses only the depots in scope, or only the owner’s', async () => {
    const a = await service.create(base({ code: 'A1', ownershipType: OwnershipType.HKP }));
    await service.create(
      base({ code: 'B1', ownershipType: OwnershipType.WARALABA, ownerId: OWNER }),
    );
    const scoped = await service.browse({ depotIds: [a.id] }, false);
    expect(scoped.items.map((d) => d.code)).toEqual(['A1']);
    const owned = await service.browse({ ownerId: OWNER }, false);
    expect(owned.items.map((d) => d.code)).toEqual(['B1']);
    // An empty scope is nothing, never everything.
    expect((await service.browse({ depotIds: [] }, false)).total).toBe(0);
  });

  it('rejects updating a code to one already taken by another depot', async () => {
    await service.create(base({ code: 'A1' }));
    const b = await service.create(base({ code: 'B1' }));
    // CA-2-53: every save now says which version it started from.
    await expect(
      service.update(b.id, { code: 'A1' }, b.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(DuplicateDepotCodeError);
  });

  it('persists ownerId on create and update', async () => {
    const d = await service.create(base({ ownerId: OWNER }));
    expect(d.ownerId).toBe(OWNER);

    const next = '22222222-2222-4222-8222-222222222222';
    const updated = await service.update(d.id, { ownerId: next }, d.updatedAt.toISOString());
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
      service.update(
        central.id,
        { ownershipType: OwnershipType.WARALABA },
        central.updatedAt.toISOString(),
      ),
    ).rejects.toBeInstanceOf(FranchiseOwnerRequiredError);

    const franchise = await service.create(
      base({ code: 'WLB-1', ownershipType: OwnershipType.WARALABA, ownerId: OWNER }),
    );
    await expect(
      service.update(franchise.id, { ownerId: null }, franchise.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(FranchiseOwnerRequiredError);

    // Naming the owner in the same patch is what makes the flip legal.
    const flipped = await service.update(
      central.id,
      { ownershipType: OwnershipType.WARALABA, ownerId: OWNER },
      central.updatedAt.toISOString(),
    );
    expect(flipped.ownerId).toBe(OWNER);
    // And a franchise depot handed back to head office may drop its owner in one patch.
    const handedBack = await service.update(
      franchise.id,
      { ownershipType: OwnershipType.HKP, ownerId: null },
      franchise.updatedAt.toISOString(),
    );
    expect(handedBack.ownerId).toBeNull();
  });

  /*
   * CA-2-53: the QRIS upload is deliberately NOT the guarded `update`. It replaces one
   * field with a file the caller just uploaded, so there is no second admin's typing to
   * erase — and routing it through `update` would have demanded a version the upload form
   * has no reason to hold, breaking a flow that has always worked.
   */
  it('replaces the QRIS image without being asked for a version', async () => {
    const d = await service.create(base({}));
    const withQris = await service.setQrisImage(d.id, 'https://cdn.example/qris/new.png');
    expect(withQris.paymentQrisImageUrl).toBe('https://cdn.example/qris/new.png');
    // …and nothing else on the row moved.
    expect(withQris.name).toBe(d.name);
    await expect(
      service.setQrisImage('00000000-0000-4000-8000-000000000000', 'x'),
    ).rejects.toThrow();
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

    const updated = await service.update(
      d.id,
      { paymentBankName: 'Mandiri' },
      d.updatedAt.toISOString(),
    );
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

  /*
   * CA-2-15. The console's depot list is now the caller's own set of ids. A deactivated
   * depot stays in it on purpose — it is still that account's depot, and hiding it is how a
   * kepala depot loses the only screen that could reactivate it. An id that no longer
   * exists is simply dropped: a stale entry in a resolved scope is not an error.
   */
  it('reads depots by id, keeps inactive ones, and drops ids that no longer exist', async () => {
    const a = await service.create(base({ code: 'IDS-A' }));
    const b = await service.create(base({ code: 'IDS-B' }));
    await service.deactivate(b.id);

    const out = await service.listByIds([b.id, a.id, 'gone']);
    expect(out.map((d) => d.id)).toEqual([b.id, a.id]);
    expect(out[0].active).toBe(false);
    await expect(service.listByIds([])).resolves.toEqual([]);
  });

  it('hides a soft-deleted depot from public get but not admin', async () => {
    const d = await service.create(base());
    await service.deactivate(d.id);
    await expect(service.get(d.id, true)).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.get(d.id, false)).resolves.toMatchObject({ id: d.id, active: false });
  });
});

describe('DepotService multi-owner', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';
  const split = (a: number, b: number) => [
    { ownerId: A, sharePct: a, isPrimary: true },
    { ownerId: B, sharePct: b, isPrimary: false },
  ];
  let repo: InMemoryDepotRepository;
  let service: DepotService;

  beforeEach(() => {
    repo = new InMemoryDepotRepository();
    service = new DepotService(repo);
  });

  const franchise = (over: Partial<CreateDepotData> = {}) =>
    service.create(base({ code: 'WLB-M', ownershipType: OwnershipType.WARALABA, ...over }));

  it('turns the legacy single ownerId into one owner at 100%', async () => {
    const d = await franchise({ ownerId: A });
    expect(d.owners).toEqual([{ ownerId: A, sharePct: 100, isPrimary: true }]);
    expect(d.ownerId).toBe(A);
  });

  it('stores several owners and mirrors the primary into ownerId', async () => {
    const d = await franchise({ owners: split(60, 40) });
    expect(d.owners).toHaveLength(2);
    expect(d.ownerId).toBe(A);
    expect((await service.listMine(B)).map((x) => x.id)).toEqual([d.id]);
  });

  it('accepts a three-way split that only adds up in hundredths', async () => {
    const d = await franchise({
      owners: [
        { ownerId: A, sharePct: 33.34, isPrimary: true },
        { ownerId: B, sharePct: 33.33, isPrimary: false },
        { ownerId: C, sharePct: 33.33, isPrimary: false },
      ],
    });
    expect(d.owners?.map((o) => o.sharePct)).toEqual([33.34, 33.33, 33.33]);
  });

  it.each([
    ['shares that do not add up to 100', split(60, 30)],
    ['shares over 100', split(110, -10)],
    [
      'no primary',
      [split(60, 40)[0], { ...split(60, 40)[1] }].map((o) => ({ ...o, isPrimary: false })),
    ],
    ['two primaries', split(60, 40).map((o) => ({ ...o, isPrimary: true }))],
    ['a duplicate owner', [split(50, 50)[0], { ...split(50, 50)[1], ownerId: A }]],
    ['a share with three decimals', split(60.005, 39.995)],
    ['a zero share', split(100, 0)],
  ])('rejects %s', async (_name, owners) => {
    await expect(franchise({ owners })).rejects.toBeInstanceOf(InvalidOwnerSharesError);
  });

  it('still requires an owner for a franchise depot', async () => {
    await expect(franchise({ owners: [] })).rejects.toBeInstanceOf(FranchiseOwnerRequiredError);
  });

  it('replaces the owner set and answers the old one as-of before the change', async () => {
    const d = await franchise({ owners: split(60, 40) });
    const before = new Date(d.updatedAt.getTime() + 1);
    const changed = await service.update(
      d.id,
      { owners: [{ ownerId: C, sharePct: 100, isPrimary: true }] },
      d.updatedAt.toISOString(),
    );
    expect(changed.ownerId).toBe(C);
    expect(changed.owners).toEqual([{ ownerId: C, sharePct: 100, isPrimary: true }]);
    expect((await service.listMine(A)).length).toBe(0);
    // An order that completed before the edit still splits 60/40.
    expect(await service.ownersAsOf(d.id, before)).toEqual(split(60, 40));
    expect(await service.ownersAsOf(d.id, new Date(changed.updatedAt.getTime() + 1))).toEqual([
      { ownerId: C, sharePct: 100, isPrimary: true },
    ]);
  });

  // Every older edit form sends the current ownerId back on each save. That must not collapse
  // a 60/40 depot into a sole owner.
  it('keeps the co-owners when a patch only repeats the current primary', async () => {
    const d = await franchise({ owners: split(60, 40) });
    const same = await service.update(
      d.id,
      { ownerId: A, name: 'Renamed' },
      d.updatedAt.toISOString(),
    );
    expect(same.owners).toEqual(split(60, 40));
    expect(same.name).toBe('Renamed');
  });

  it('names a different bare ownerId as the new sole owner', async () => {
    const d = await franchise({ owners: split(60, 40) });
    const moved = await service.update(d.id, { ownerId: C }, d.updatedAt.toISOString());
    expect(moved.owners).toEqual([{ ownerId: C, sharePct: 100, isPrimary: true }]);
  });

  it('refuses to orphan a franchise depot', async () => {
    const d = await franchise({ owners: split(60, 40) });
    await expect(
      service.update(d.id, { owners: [] }, d.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(FranchiseOwnerRequiredError);
  });

  it('falls back to the current set for a moment before any generation was recorded', async () => {
    const d = await franchise({ owners: split(60, 40) });
    expect(await service.ownersAsOf(d.id, new Date(0))).toEqual(split(60, 40));
  });
});
