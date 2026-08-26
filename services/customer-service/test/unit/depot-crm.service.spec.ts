import { NotFoundException } from '@nestjs/common';

import { DepotCrmService } from '../../src/application/services/depot-crm.service';
import { DepotCrmRepository, DepotCustomerRow } from '../../src/application/ports/depot-crm.repository';
import { DepotCustomerOrderStats, OrderCrmPort } from '../../src/application/ports/order-crm.port';
import { AddressRecord, AddressRepository } from '../../src/application/ports/address.repository';
import { CustomerProfileRecord, ProfileRepository } from '../../src/application/ports/profile.repository';
import { CustomerIdentity, IdentityPort } from '../../src/application/ports/identity.port';
import { MembershipTier } from '../../src/domain/membership-tier.enum';

// Minimal fake: findIdsByDepot + listDepotCustomers are exercised here.
class FakeDepotCrmRepository implements DepotCrmRepository {
  byDepot = new Map<string, string[]>();
  rows: DepotCustomerRow[] = [];
  async listDepotCustomers(): Promise<DepotCustomerRow[]> {
    return this.rows;
  }
  async findIdsByDepot(depotId: string): Promise<string[]> {
    return this.byDepot.get(depotId) ?? [];
  }
}

/** auth-service stand-in. Empty by default = the fail-soft path (no account names). */
class FakeIdentity implements IdentityPort {
  names = new Map<string, CustomerIdentity>();
  asked: string[][] = [];
  preRegisterCustomer = jest.fn();
  async getCustomerNames(ids: string[]): Promise<Map<string, CustomerIdentity>> {
    this.asked.push(ids);
    return this.names;
  }
}

describe('DepotCrmService.listCustomerIdsByDepot', () => {
  it('returns only the ids whose favourite depot matches', async () => {
    const repo = new FakeDepotCrmRepository();
    repo.byDepot.set('depot-a', ['c1', 'c2']);
    repo.byDepot.set('depot-b', ['c3']);
    const service = new DepotCrmService(repo, {} as never, {} as never, {} as never, { gallonsByCustomer: async () => null } as never, new FakeIdentity(), {} as never);

    expect(await service.listCustomerIdsByDepot('depot-a')).toEqual(['c1', 'c2']);
    expect(await service.listCustomerIdsByDepot('depot-b')).toEqual(['c3']);
    expect(await service.listCustomerIdsByDepot('depot-unknown')).toEqual([]);
  });
});

describe('DepotCrmService.getCrmDashboard', () => {
  const config = { crmThresholds: { newDays: 30, activeDays: 30, followUpDays: 60 } } as never;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  function serviceWithStats(stats: DepotCustomerOrderStats[]): DepotCrmService {
    const orderCrm: OrderCrmPort = { depotCustomerStats: async () => stats, customerOrders: async () => [] };
    return new DepotCrmService(new FakeDepotCrmRepository(), {} as never, {} as never, orderCrm, { gallonsByCustomer: async () => null } as never, new FakeIdentity(), config);
  }

  it('counts segments, repeat rate, and overdue follow-ups (most-overdue first)', async () => {
    const service = serviceWithStats([
      { customerId: 'baru', name: 'B', phone: '1', orderCount: 1, totalSpent: 50_000, firstOrderAt: daysAgo(5), lastOrderAt: daysAgo(5) },
      { customerId: 'aktif', name: 'A', phone: '2', orderCount: 4, totalSpent: 200_000, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(10) },
      { customerId: 'lapse', name: 'L', phone: '3', orderCount: 2, totalSpent: 90_000, firstOrderAt: daysAgo(300), lastOrderAt: daysAgo(70) },
      { customerId: 'gone', name: 'G', phone: '4', orderCount: 1, totalSpent: 30_000, firstOrderAt: daysAgo(400), lastOrderAt: daysAgo(120) },
    ]);

    const d = await service.getCrmDashboard('depot-a');

    expect(d.counts).toEqual({ baru: 1, aktif: 1, inactive: 2, total: 4 });
    expect(d.repeatRatePct).toBe(50); // aktif(4) + lapse(2) have >1 order
    expect(d.followUps.map((f) => f.customerId)).toEqual(['gone', 'lapse']); // 120d before 70d
  });

  it('empty stats → zeroed dashboard', async () => {
    const d = await serviceWithStats([]).getCrmDashboard('depot-a');
    expect(d).toEqual({ counts: { baru: 0, aktif: 0, inactive: 0, total: 0 }, repeatRatePct: 0, followUps: [] });
  });
});

describe('DepotCrmService.listDepotCustomers', () => {
  const config = { crmThresholds: { newDays: 30, activeDays: 30, followUpDays: 60 } } as never;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const row = (customerId: string): DepotCustomerRow => ({
    customerId,
    fullName: `name-${customerId}`,
    phone: `phone-${customerId}`,
    membershipTier: MembershipTier.BASIC,
  });

  function service(
    rows: DepotCustomerRow[],
    stats: DepotCustomerOrderStats[],
    identity: IdentityPort = new FakeIdentity(),
    subscribers: string[] | null = null,
  ): DepotCrmService {
    const repo = new FakeDepotCrmRepository();
    repo.rows = rows;
    const orderCrm: OrderCrmPort = { depotCustomerStats: async () => stats, customerOrders: async () => [] };
    const depotProfile = { subscriberIds: async () => subscribers, geo: async () => null };
    return new DepotCrmService(
      repo,
      {} as never,
      {} as never,
      orderCrm,
      { gallonsByCustomer: async () => null } as never,
      identity,
      config,
      depotProfile as never,
      { bandFor: async () => null } as never,
    );
  }

  it('merges order stats onto rows that have them, and nulls the rest', async () => {
    const fiveDaysAgo = daysAgo(5);
    const svc = service(
      [row('c1'), row('c2')],
      [{ customerId: 'c1', name: 'n', phone: 'p', orderCount: 3, totalSpent: 90_000, firstOrderAt: fiveDaysAgo, lastOrderAt: fiveDaysAgo }],
    );

    const [withStats, without] = await svc.listDepotCustomers('depot-a');

    // c1 gets its aggregate + a computed segment (first order 5d ago → BARU).
    expect(withStats).toMatchObject({ id: 'c1', orderCount: 3, segment: 'BARU', gallonsOnLoan: null, depositHeldIdr: null, isSubscriber: null });
    expect(withStats!.lastOrderAt).toBe(fiveDaysAgo.toISOString());
    // c2 has no matching stats row → order aggregates null, segment null.
    expect(without).toMatchObject({ id: 'c2', orderCount: null, lastOrderAt: null, segment: null });
  });

  /*
   * S2. The directory asks ONCE for the whole set rather than once per row — and null still
   * means "depot-service went quiet", which is not the same sentence as "not a subscriber".
   */
  it('flags subscribers across the directory from one read', async () => {
    const rows = await service([row('c1'), row('c2')], [], new FakeIdentity(), ['c2']).listDepotCustomers(
      'depot-a',
    );
    expect(rows.map((r) => [r.id, r.isSubscriber])).toEqual([
      ['c1', false],
      ['c2', true],
    ]);
  });

  it('empty stats → every row is order-less (all null)', async () => {
    const [only] = await service([row('c9')], []).listDepotCustomers('depot-a');
    expect(only).toMatchObject({ id: 'c9', orderCount: null, lastOrderAt: null, segment: null });
  });

  it('shows the ACCOUNT name, not the primary address recipient', async () => {
    const identity = new FakeIdentity();
    identity.names.set('c1', { fullName: 'Budi Santoso', phone: '0811' });
    const [only] = await service([row('c1')], [], identity).listDepotCustomers('depot-a');
    expect(only).toMatchObject({ id: 'c1', fullName: 'Budi Santoso', phone: '0811' });
    expect(identity.asked).toEqual([['c1']]);
  });

  it('a customer with no saved address still lists under their account name', async () => {
    // The old SQL read the name off the primary address, so this customer was "Tanpa nama".
    const identity = new FakeIdentity();
    identity.names.set('c2', { fullName: 'Siti', phone: '0822' });
    const nameless: DepotCustomerRow = { customerId: 'c2', fullName: null, phone: null, membershipTier: MembershipTier.BASIC };
    const [only] = await service([nameless], [], identity).listDepotCustomers('depot-a');
    expect(only).toMatchObject({ fullName: 'Siti', phone: '0822' });
  });

  it('auth-service silent → keeps the address name rather than blanking the row', async () => {
    const [only] = await service([row('c3')], []).listDepotCustomers('depot-a');
    expect(only).toMatchObject({ fullName: 'name-c3', phone: 'phone-c3' });
  });

  it('search matches the account name the staff member can actually see', async () => {
    const identity = new FakeIdentity();
    identity.names.set('c1', { fullName: 'Budi Santoso', phone: '0811' });
    identity.names.set('c2', { fullName: 'Siti Aminah', phone: '0822' });
    const svc = service([row('c1'), row('c2')], [], identity);

    expect((await svc.listDepotCustomers('depot-a', ' bUdI ')).map((i) => i.id)).toEqual(['c1']);
    expect((await svc.listDepotCustomers('depot-a', '0822')).map((i) => i.id)).toEqual(['c2']);
    expect((await svc.listDepotCustomers('depot-a', 'name-c1')).map((i) => i.id)).toEqual([]);
    expect((await svc.listDepotCustomers('depot-a', '   ')).map((i) => i.id)).toEqual(['c1', 'c2']);
  });
});

describe('DepotCrmService.getDepotDetail', () => {
  const addr = (over: Partial<AddressRecord>): AddressRecord => ({
    id: 'a1',
    customerId: 'c1',
    label: 'Home',
    recipientName: 'Recipient',
    phone: '0812',
    addressLine: 'Jl. Air 1',
    city: 'Bandung',
    province: 'Jabar',
    postalCode: null,
    latitude: -6.9,
    longitude: 107.6,
    notes: null,
    isPrimary: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  });

  /** Everything the detail screen reads cross-service; each defaults to "nothing known". */
  interface Wired {
    stats?: DepotCustomerOrderStats[];
    gallons?: { customerId: string; gallonsOnLoan: number; depositHeldIdr: number }[] | null;
    ledger?: { id: string; type: 'ISSUE' | 'RETURN'; quantity: number; amountIdr: number; at: string }[];
    orders?: { id: string; orderNumber: string; status: string; totalIdr: number; placedAt: string }[];
    /** S2. Undefined = the port is not wired at all, which is what it was before. */
    subscribers?: string[] | null;
    geo?: { lat: number; lng: number; serviceRadiusKm: number } | null;
    churn?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  }

  function service(
    profile: CustomerProfileRecord | null,
    addresses: AddressRecord[],
    identity: IdentityPort = new FakeIdentity(),
    wired: Wired = {},
  ): DepotCrmService {
    const profiles: ProfileRepository = { findByCustomerId: async () => profile } as unknown as ProfileRepository;
    const addressRepo: AddressRepository = { listByCustomer: async () => addresses } as unknown as AddressRepository;
    const orderCrm: OrderCrmPort = {
      depotCustomerStats: async () => wired.stats ?? [],
      customerOrders: async () => wired.orders ?? [],
    };
    const depotLedger = {
      gallonsByCustomer: async () => (wired.gallons === undefined ? null : wired.gallons),
      customerLedger: async () => wired.ledger ?? [],
    };
    const depotProfile = {
      subscriberIds: async () => (wired.subscribers === undefined ? null : wired.subscribers),
      geo: async () => (wired.geo === undefined ? null : wired.geo),
    };
    const churn = { bandFor: async () => (wired.churn === undefined ? null : wired.churn) };
    return new DepotCrmService(
      new FakeDepotCrmRepository(),
      addressRepo,
      profiles,
      orderCrm,
      depotLedger as never,
      identity,
      {} as never,
      depotProfile as never,
      churn as never,
    );
  }

  const profile = (tier: MembershipTier): CustomerProfileRecord => ({
    customerId: 'c1',
    membershipTier: tier,
    pointBalance: 0,
    // Belongs to the depot the card is being read at — AUTHZ-A7 refuses a customer who
    // does not, so every mapping test below states the membership it relies on.
    favoriteDepotId: 'depot-a',
    birthdate: null,
    lastBirthdayRewardYear: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  /*
   * AUTHZ-A7. The card answered for ANY customer id at any depot the caller runs: full
   * name, phone, and the complete address book — home, office, everywhere they take
   * delivery — of somebody who has never dealt with that depot. The id is not a secret;
   * every depot's own directory hands them out.
   *
   * Belonging to a depot is one of two things, and both are already read here: the
   * customer's favourite depot IS this depot, or they have ordered from it.
   */
  describe('a customer who has nothing to do with this depot', () => {
    it('is not found, and no address book comes back with the refusal', async () => {
      const svc = service(profile(MembershipTier.GOLD), [addr({ id: 'a1', isPrimary: true })]);
      await expect(svc.getDepotDetail('c1', 'depot-lain')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is served when they have ordered there, even with no favourite depot set', async () => {
      const svc = service(null, [], new FakeIdentity(), {
        stats: [
          {
            customerId: 'c1',
            name: 'n',
            phone: 'p',
            orderCount: 1,
            totalSpent: 1,
            firstOrderAt: null,
            lastOrderAt: null,
          },
        ],
      });
      await expect(svc.getDepotDetail('c1', 'depot-a')).resolves.toMatchObject({
        profile: { id: 'c1' },
      });
    });
  });

  it('takes name/phone/tier from the PRIMARY address and maps every address', async () => {
    const svc = service(profile(MembershipTier.GOLD), [
      addr({ id: 'a1', isPrimary: false, recipientName: 'Secondary', phone: '0001' }),
      addr({ id: 'a2', isPrimary: true, recipientName: 'Primary', phone: '0002' }),
    ]);

    const d = await svc.getDepotDetail('c1', 'depot-a');

    expect(d.profile).toMatchObject({
      id: 'c1',
      fullName: 'Primary',
      phone: '0002',
      membershipTier: MembershipTier.GOLD,
      isSubscriber: null,
      orderCount: null,
      churnRisk: null,
    });
    expect(d.addresses).toHaveLength(2);
    expect(d.addresses[0]).toMatchObject({ id: 'a1', inRadius: null, distanceKm: null, isPrimary: false });
    expect(d.depositLedger).toEqual([]);
    expect(d.recentOrders).toEqual([]);
  });

  it('falls back to the first address when none is primary', async () => {
    const svc = service(profile(MembershipTier.SILVER), [addr({ recipientName: 'First', phone: '0009' })]);
    const d = await svc.getDepotDetail('c1', 'depot-a');
    expect(d.profile).toMatchObject({ fullName: 'First', phone: '0009', membershipTier: MembershipTier.SILVER });
  });

  it('no profile + no addresses → BASIC tier and null name/phone', async () => {
    // Known to the depot through their orders rather than a profile — see AUTHZ-A7 above.
    const d = await service(null, [], new FakeIdentity(), {
      stats: [
        {
          customerId: 'c1',
          name: null,
          phone: null,
          orderCount: 1,
          totalSpent: 1,
          firstOrderAt: null,
          lastOrderAt: null,
        },
      ],
    }).getDepotDetail('c1', 'depot-a');
    expect(d.profile).toMatchObject({ fullName: null, phone: null, membershipTier: MembershipTier.BASIC });
    expect(d.addresses).toEqual([]);
  });

  it('fills the cross-service numbers, the ledger and the recent orders', async () => {
    const svc = service(profile(MembershipTier.BASIC), [], new FakeIdentity(), {
      stats: [
        { customerId: 'c1', name: 'n', phone: 'p', orderCount: 3, totalSpent: 90_000.4, firstOrderAt: null, lastOrderAt: null },
        { customerId: 'other', name: null, phone: null, orderCount: 9, totalSpent: 1, firstOrderAt: null, lastOrderAt: null },
      ],
      gallons: [
        { customerId: 'c1', gallonsOnLoan: 2, depositHeldIdr: 40_000 },
        { customerId: 'other', gallonsOnLoan: 7, depositHeldIdr: 1 },
      ],
      ledger: [{ id: 'l1', type: 'ISSUE', quantity: 2, amountIdr: 40_000, at: '2026-08-01T00:00:00.000Z' }],
      orders: [{ id: 'o1', orderNumber: 'HM-1', status: 'COMPLETED', totalIdr: 50_000, placedAt: '2026-08-02T00:00:00.000Z' }],
    });

    const d = await svc.getDepotDetail('c1', 'depot-a');

    // Rounded, and the other customer's row is not the one that lands here.
    expect(d.profile).toMatchObject({ orderCount: 3, totalSpentIdr: 90_000, gallonsOnLoan: 2, depositHeldIdr: 40_000 });
    expect(d.depositLedger).toHaveLength(1);
    // `orderNumber` is not part of the screen's row shape — it must not leak through.
    expect(d.recentOrders).toEqual([
      { id: 'o1', status: 'COMPLETED', totalIdr: 50_000, placedAt: '2026-08-02T00:00:00.000Z' },
    ]);
  });

  // The distinction the whole J-2 fix exists for: a customer nobody has data ON, at a depot
  // whose services DID answer, is a real zero. An unreachable service is not.
  it('a customer missing from an answered aggregate is 0, not null', async () => {
    const d = await service(profile(MembershipTier.BASIC), [], new FakeIdentity(), {
      stats: [{ customerId: 'someone-else', name: null, phone: null, orderCount: 1, totalSpent: 1, firstOrderAt: null, lastOrderAt: null }],
      gallons: [{ customerId: 'someone-else', gallonsOnLoan: 1, depositHeldIdr: 1 }],
    }).getDepotDetail('c1', 'depot-a');

    expect(d.profile).toMatchObject({ orderCount: 0, totalSpentIdr: 0, gallonsOnLoan: 0, depositHeldIdr: 0 });
  });

  it('unreachable order-service and depot-service stay null, never 0', async () => {
    const d = await service(profile(MembershipTier.BASIC), [], new FakeIdentity(), { stats: [], gallons: null }).getDepotDetail('c1', 'depot-a');
    expect(d.profile).toMatchObject({ orderCount: null, totalSpentIdr: null, gallonsOnLoan: null, depositHeldIdr: null });
  });

  /*
   * S2 — the three fields this card hardcoded to null. Each has a "not known" state that is
   * NOT the same as its false/zero, and that distinction is the whole point of the tests
   * below: an unreachable service must not print as "not a subscriber", "low churn risk",
   * or "0 km away, inside the radius".
   */
  it('marks a linked subscriber, and everyone else as not one', async () => {
    const sub = await service(profile(MembershipTier.BASIC), [], new FakeIdentity(), {
      subscribers: ['c1', 'c9'],
    }).getDepotDetail('c1', 'depot-a');
    expect(sub.profile.isSubscriber).toBe(true);

    const not = await service(profile(MembershipTier.BASIC), [], new FakeIdentity(), {
      subscribers: ['c9'],
    }).getDepotDetail('c1', 'depot-a');
    expect(not.profile.isSubscriber).toBe(false);
  });

  it('leaves isSubscriber and churnRisk null when their services went quiet', async () => {
    const d = await service(profile(MembershipTier.BASIC), [], new FakeIdentity(), {
      subscribers: null,
      churn: null,
    }).getDepotDetail('c1', 'depot-a');
    expect(d.profile.isSubscriber).toBeNull();
    // Null, never LOW: low risk is the answer a manager acts on by doing nothing.
    expect(d.profile.churnRisk).toBeNull();
  });

  // The pre-S2 shape: neither optional port injected at all. It must behave exactly as it
  // did before — three nulls — rather than throw on a service built the old way.
  it('reports all three as null when neither optional port is wired', async () => {
    // Member of this depot (AUTHZ-A7); what this test is about is the two unwired ports.
    const profiles = {
      findByCustomerId: async () => profile(MembershipTier.BASIC),
    } as unknown as ProfileRepository;
    const addressRepo = { listByCustomer: async () => [addr({})] } as unknown as AddressRepository;
    const orderCrm: OrderCrmPort = { depotCustomerStats: async () => [], customerOrders: async () => [] };
    const svc = new DepotCrmService(
      new FakeDepotCrmRepository(),
      addressRepo,
      profiles,
      orderCrm,
      { gallonsByCustomer: async () => null, customerLedger: async () => [] } as never,
      new FakeIdentity(),
      {} as never,
    );

    const d = await svc.getDepotDetail('c1', 'depot-a');
    expect(d.profile.isSubscriber).toBeNull();
    expect(d.profile.churnRisk).toBeNull();
    expect(d.addresses[0]).toMatchObject({ distanceKm: null, inRadius: null });
  });

  it('carries the churn band forecast-service scored', async () => {
    const d = await service(profile(MembershipTier.BASIC), [], new FakeIdentity(), { churn: 'HIGH' }).getDepotDetail(
      'c1',
      'depot-a',
    );
    expect(d.profile.churnRisk).toBe('HIGH');
  });

  it('measures each address against the depot radius, to one decimal', async () => {
    // ~1.1 km north of the depot, well inside a 5 km radius.
    const d = await service(profile(MembershipTier.BASIC), [addr({ latitude: -6.89, longitude: 107.6 })], new FakeIdentity(), {
      geo: { lat: -6.9, lng: 107.6, serviceRadiusKm: 5 },
    }).getDepotDetail('c1', 'depot-a');
    expect(d.addresses[0].distanceKm).toBeCloseTo(1.1, 1);
    expect(d.addresses[0].inRadius).toBe(true);
  });

  it('calls an address beyond the radius out of range', async () => {
    const d = await service(profile(MembershipTier.BASIC), [addr({ latitude: -7.4, longitude: 107.6 })], new FakeIdentity(), {
      geo: { lat: -6.9, lng: 107.6, serviceRadiusKm: 5 },
    }).getDepotDetail('c1', 'depot-a');
    expect(d.addresses[0].distanceKm).toBeGreaterThan(5);
    expect(d.addresses[0].inRadius).toBe(false);
  });

  // An address nobody pinned cannot be in or out of a radius. Answering "0 km, in range"
  // would send a courier to a place the system does not actually know.
  it.each([
    ['the address has no coordinates', { latitude: null, longitude: null }, { lat: -6.9, lng: 107.6, serviceRadiusKm: 5 }],
    ['the depot location could not be read', {}, null],
  ])('leaves distance and inRadius null when %s', async (_label, addrOver, geo) => {
    const d = await service(profile(MembershipTier.BASIC), [addr(addrOver)], new FakeIdentity(), {
      geo: geo as never,
    }).getDepotDetail('c1', 'depot-a');
    expect(d.addresses[0].distanceKm).toBeNull();
    expect(d.addresses[0].inRadius).toBeNull();
  });
});
