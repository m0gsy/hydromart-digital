import { DepotCrmService } from '../../src/application/services/depot-crm.service';
import { DepotCrmRepository, DepotCustomerRow } from '../../src/application/ports/depot-crm.repository';
import { DepotCustomerOrderStats, OrderCrmPort } from '../../src/application/ports/order-crm.port';
import { AddressRecord, AddressRepository } from '../../src/application/ports/address.repository';
import { CustomerProfileRecord, ProfileRepository } from '../../src/application/ports/profile.repository';
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

describe('DepotCrmService.listCustomerIdsByDepot', () => {
  it('returns only the ids whose favourite depot matches', async () => {
    const repo = new FakeDepotCrmRepository();
    repo.byDepot.set('depot-a', ['c1', 'c2']);
    repo.byDepot.set('depot-b', ['c3']);
    const service = new DepotCrmService(repo, {} as never, {} as never, {} as never, {} as never);

    expect(await service.listCustomerIdsByDepot('depot-a')).toEqual(['c1', 'c2']);
    expect(await service.listCustomerIdsByDepot('depot-b')).toEqual(['c3']);
    expect(await service.listCustomerIdsByDepot('depot-unknown')).toEqual([]);
  });
});

describe('DepotCrmService.getCrmDashboard', () => {
  const config = { crmThresholds: { newDays: 30, activeDays: 30, followUpDays: 60 } } as never;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  function serviceWithStats(stats: DepotCustomerOrderStats[]): DepotCrmService {
    const orderCrm: OrderCrmPort = { depotCustomerStats: async () => stats };
    return new DepotCrmService(new FakeDepotCrmRepository(), {} as never, {} as never, orderCrm, config);
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

  function service(rows: DepotCustomerRow[], stats: DepotCustomerOrderStats[]): DepotCrmService {
    const repo = new FakeDepotCrmRepository();
    repo.rows = rows;
    const orderCrm: OrderCrmPort = { depotCustomerStats: async () => stats };
    return new DepotCrmService(repo, {} as never, {} as never, orderCrm, config);
  }

  it('merges order stats onto rows that have them, and nulls the rest', async () => {
    const fiveDaysAgo = daysAgo(5);
    const svc = service(
      [row('c1'), row('c2')],
      [{ customerId: 'c1', name: 'n', phone: 'p', orderCount: 3, totalSpent: 90_000, firstOrderAt: fiveDaysAgo, lastOrderAt: fiveDaysAgo }],
    );

    const [withStats, without] = await svc.listDepotCustomers('depot-a', 'q');

    // c1 gets its aggregate + a computed segment (first order 5d ago → BARU).
    expect(withStats).toMatchObject({ id: 'c1', orderCount: 3, segment: 'BARU', gallonsOnLoan: null, depositHeldIdr: null, isSubscriber: null });
    expect(withStats!.lastOrderAt).toBe(fiveDaysAgo.toISOString());
    // c2 has no matching stats row → order aggregates null, segment null.
    expect(without).toMatchObject({ id: 'c2', orderCount: null, lastOrderAt: null, segment: null });
  });

  it('empty stats → every row is order-less (all null)', async () => {
    const [only] = await service([row('c9')], []).listDepotCustomers('depot-a');
    expect(only).toMatchObject({ id: 'c9', orderCount: null, lastOrderAt: null, segment: null });
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

  function service(profile: CustomerProfileRecord | null, addresses: AddressRecord[]): DepotCrmService {
    const profiles: ProfileRepository = { findByCustomerId: async () => profile } as unknown as ProfileRepository;
    const addressRepo: AddressRepository = { listByCustomer: async () => addresses } as unknown as AddressRepository;
    return new DepotCrmService(new FakeDepotCrmRepository(), addressRepo, profiles, {} as never, {} as never);
  }

  const profile = (tier: MembershipTier): CustomerProfileRecord => ({
    customerId: 'c1',
    membershipTier: tier,
    pointBalance: 0,
    favoriteDepotId: null,
    birthdate: null,
    lastBirthdayRewardYear: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
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
    const d = await service(null, []).getDepotDetail('c1', 'depot-a');
    expect(d.profile).toMatchObject({ fullName: null, phone: null, membershipTier: MembershipTier.BASIC });
    expect(d.addresses).toEqual([]);
  });
});
