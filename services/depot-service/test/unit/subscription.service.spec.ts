import { randomUUID } from 'node:crypto';

import { SubscriptionService } from '../../src/application/services/subscription.service';
import {
  Subscription,
  SubscriptionCadence,
  SubscriptionStatus,
} from '../../src/domain/subscription';
import { DepotNotFoundError, SubscriptionNotFoundError } from '../../src/domain/errors';
import {
  CreateSubscriptionData,
  SubscriptionRepository,
  UpdateSubscriptionData,
} from '../../src/application/ports/subscription.repository';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import { InMemoryDepotRepository } from '../support/fakes';

class InMemorySubscriptionRepository implements SubscriptionRepository {
  rows: Subscription[] = [];

  async create(data: CreateSubscriptionData): Promise<Subscription> {
    const now = new Date();
    const row: Subscription = {
      id: randomUUID(),
      status: SubscriptionStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.rows.push(row);
    return row;
  }

  async listForDepot(depotId: string, status?: SubscriptionStatus): Promise<Subscription[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && (!status || r.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async activeCustomerIdsForDepot(depotId: string): Promise<string[]> {
    return [
      ...new Set(
        this.rows
          .filter(
            (r) =>
              r.depotId === depotId &&
              r.status === SubscriptionStatus.ACTIVE &&
              r.customerId !== null,
          )
          .map((r) => r.customerId as string),
      ),
    ];
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async update(id: string, data: UpdateSubscriptionData): Promise<Subscription> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }
}

const UNKNOWN = '00000000-0000-0000-0000-000000000000';

describe('SubscriptionService', () => {
  let repo: InMemorySubscriptionRepository;
  let service: SubscriptionService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemorySubscriptionRepository();
    service = new SubscriptionService(repo, depotRepo);
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'a',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  const seed = () =>
    service.create({
      depotId,
      customerName: 'Ibu Sari',
      productLabel: 'Galon 19L',
      quantity: 2,
      cadence: SubscriptionCadence.WEEKLY,
    });

  it('creates ACTIVE, then pause/resume toggles status', async () => {
    const sub = await seed();
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);

    const paused = await service.pause(sub.id);
    expect(paused.status).toBe(SubscriptionStatus.PAUSED);

    const resumed = await service.resume(sub.id);
    expect(resumed.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('throws NotFound pausing, resuming or reading a missing subscription', async () => {
    await expect(service.pause(UNKNOWN)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    await expect(service.resume(UNKNOWN)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    await expect(service.get(UNKNOWN)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
  });

  it('rejects creating or listing against an unknown depot', async () => {
    await expect(
      service.create({
        depotId: UNKNOWN,
        customerName: 'Ibu Sari',
        productLabel: 'Galon 19L',
        quantity: 1,
        cadence: SubscriptionCadence.WEEKLY,
      }),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.list(UNKNOWN)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('lists depot subscriptions, filters by status, and reads one by id', async () => {
    const a = await seed();
    const b = await seed();
    await service.pause(a.id);

    expect((await service.list(depotId)).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(
      (await service.list(depotId, { status: SubscriptionStatus.ACTIVE })).map((s) => s.id),
    ).toEqual([b.id]);
    expect((await service.get(a.id)).status).toBe(SubscriptionStatus.PAUSED);
  });

  it('keeps an explicit customerId, nextRunAt and note instead of the null defaults', async () => {
    const nextRunAt = new Date('2026-08-01T00:00:00.000Z');
    const sub = await service.create({
      depotId,
      customerId: '44444444-4444-4444-4444-444444444444',
      customerName: 'Pak Budi',
      productLabel: 'Galon 19L',
      quantity: 3,
      cadence: SubscriptionCadence.MONTHLY,
      nextRunAt,
      note: 'Titip pos satpam',
    });
    expect(sub.customerId).toBe('44444444-4444-4444-4444-444444444444');
    expect(sub.nextRunAt).toEqual(nextRunAt);
    expect(sub.note).toBe('Titip pos satpam');
  });
});

/*
 * S2. `isSubscriber` on the depot CRM card was a hardcoded null because most subscription
 * rows carried a free-text name and no `customerId`. This is the read that fixes it — and
 * it deliberately answers about LINKED rows only: a subscription nobody attached to an
 * account is not evidence that the person does not subscribe, which is why the create
 * route now insists on a real customer.
 */
describe('SubscriptionService.activeCustomerIds', () => {
  it('returns distinct linked customers with an ACTIVE subscription at this depot', async () => {
    const repo = new InMemorySubscriptionRepository();
    const depots = { exists: async () => true } as never;
    const service = new SubscriptionService(repo, depots);
    const base = {
      depotId: 'depot-a',
      customerName: 'x',
      productLabel: 'Galon 19L',
      quantity: 1,
      cadence: SubscriptionCadence.WEEKLY,
      nextRunAt: null,
      note: null,
    };
    await service.create({ ...base, customerId: 'c1' });
    // Same customer twice → one id, not two.
    await service.create({ ...base, customerId: 'c1' });
    await service.create({ ...base, customerId: 'c2' });
    // Unlinked row: it exists, but there is no id to answer with.
    await service.create({ ...base, customerId: null });
    // Another depot's subscriber must not leak into this depot's directory.
    await service.create({ ...base, depotId: 'depot-b', customerId: 'c9' });
    // Paused: they are not currently subscribing.
    const paused = await service.create({ ...base, customerId: 'c3' });
    await service.pause(paused.id);

    const ids = await service.activeCustomerIds('depot-a');
    expect([...ids].sort()).toEqual(['c1', 'c2']);
  });

  it('returns an empty set for a depot with no linked subscribers', async () => {
    const service = new SubscriptionService(
      new InMemorySubscriptionRepository(),
      { exists: async () => true } as never,
    );
    await expect(service.activeCustomerIds('depot-a')).resolves.toEqual([]);
  });
});
