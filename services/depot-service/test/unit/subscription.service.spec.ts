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
