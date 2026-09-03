import { randomUUID } from 'node:crypto';

import { DisputeService } from '../../src/application/services/dispute.service';
import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../src/domain/order-dispute';
import {
  DepotNotFoundError,
  DisputeAlreadyResolvedError,
  DisputeNotFoundError,
} from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import {
  CreateDisputeData,
  DisputeRepository,
  UpdateDisputeData,
} from '../../src/application/ports/dispute.repository';
import { FakeDisputeRefund, InMemoryDepotRepository } from '../support/fakes';

// Local in-memory DisputeRepository (do not edit shared fakes.ts).
class InMemoryDisputeRepository implements DisputeRepository {
  rows: OrderDispute[] = [];
  private seq = 0;
  private next(): Date {
    return new Date(1_800_000_000_000 + (this.seq += 1) * 1000);
  }

  async create(data: CreateDisputeData): Promise<OrderDispute> {
    const at = this.next();
    const row: OrderDispute = {
      id: randomUUID(),
      ...data,
      status: DisputeStatus.OPEN,
      resolution: null,
      resolutionNote: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return { ...row };
  }
  async listForDepot(depotId: string, status?: DisputeStatus): Promise<OrderDispute[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && (!status || r.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }
  async findById(id: string): Promise<OrderDispute | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async update(id: string, data: UpdateDisputeData): Promise<OrderDispute> {
    const rec = this.rows.find((x) => x.id === id)!;
    Object.assign(rec, data, { updatedAt: this.next() });
    return { ...rec };
  }
}

const RAISER = '11111111-1111-1111-1111-111111111111';
const MANAGER = '22222222-2222-2222-2222-222222222222';
const UNKNOWN = '00000000-0000-0000-0000-000000000000';

describe('DisputeService', () => {
  let repo: InMemoryDisputeRepository;
  let service: DisputeService;
  let depotId: string;
  let refunds: FakeDisputeRefund;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryDisputeRepository();
    refunds = new FakeDisputeRefund();
    service = new DisputeService(repo, depotRepo, refunds);
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

  const raise = () =>
    service.raise(
      {
        depotId,
        orderRef: 'HM-000476',
        customerName: 'Ibu Sari',
        category: DisputeCategory.WRONG_ITEM,
        description: 'Galon salah kirim',
      },
      RAISER,
    );

  it('creates an OPEN dispute stamping the raiser and defaulting amount to 0', async () => {
    const d = await raise();
    expect(d.status).toBe(DisputeStatus.OPEN);
    expect(d.raisedBy).toBe(RAISER);
    expect(d.amountIdr).toBe(0);
    expect(d.resolvedAt).toBeNull();
  });

  it('resolves REFUND/RESEND as RESOLVED and REJECTED as REJECTED, stamping the resolver', async () => {
    const a = await raise();
    const refunded = await service.resolve(
      a.id,
      DisputeResolution.REFUND,
      'Dana dikembalikan',
      MANAGER,
    );
    expect(refunded.status).toBe(DisputeStatus.RESOLVED);
    expect(refunded.resolution).toBe(DisputeResolution.REFUND);
    expect(refunded.resolvedBy).toBe(MANAGER);
    expect(refunded.resolvedAt).not.toBeNull();

    const b = await raise();
    const rejected = await service.resolve(b.id, DisputeResolution.REJECTED, null, MANAGER);
    expect(rejected.status).toBe(DisputeStatus.REJECTED);
  });

  it('refuses to resolve an already-resolved dispute', async () => {
    const a = await raise();
    await service.resolve(a.id, DisputeResolution.RESEND, null, MANAGER);
    await expect(
      service.resolve(a.id, DisputeResolution.REFUND, null, MANAGER),
    ).rejects.toBeInstanceOf(DisputeAlreadyResolvedError);
  });

  it('rejects an unknown id', async () => {
    await expect(
      service.resolve(UNKNOWN, DisputeResolution.REFUND, null, MANAGER),
    ).rejects.toBeInstanceOf(DisputeNotFoundError);
    await expect(service.get(UNKNOWN)).rejects.toBeInstanceOf(DisputeNotFoundError);
  });

  it('rejects raising or listing against an unknown depot', async () => {
    await expect(
      service.raise(
        {
          depotId: UNKNOWN,
          orderRef: 'HM-000477',
          customerName: 'Ibu Sari',
          category: DisputeCategory.NOT_RECEIVED,
          description: 'Telat',
        },
        RAISER,
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.list(UNKNOWN)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('lists depot disputes newest-first, filters by status, and reads one by id', async () => {
    const a = await raise();
    const b = await raise();
    await service.resolve(a.id, DisputeResolution.REFUND, 'ok', MANAGER);

    expect((await service.list(depotId)).map((d) => d.id)).toEqual([b.id, a.id]);
    expect((await service.list(depotId, DisputeStatus.OPEN)).map((d) => d.id)).toEqual([b.id]);
    expect((await service.get(a.id)).status).toBe(DisputeStatus.RESOLVED);
  });

  it('keeps an explicit amount and courier name instead of the defaults', async () => {
    const d = await service.raise(
      {
        depotId,
        orderRef: 'HM-000478',
        customerName: 'Pak Budi',
        category: DisputeCategory.WRONG_ITEM,
        description: 'Salah',
        amountIdr: 45_000,
        courierName: 'Andi',
      },
      RAISER,
    );
    expect(d.amountIdr).toBe(45_000);
    expect(d.courierName).toBe('Andi');
  });
});

/** CA-2-39: the same depot every test in this block needs, without the outer beforeEach. */
async function seedDepot(depotRepo: InMemoryDepotRepository): Promise<string> {
  const depot = await new DepotService(depotRepo).create({
    code: 'JKT-09',
    name: 'Depot Refund',
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
  return depot.id;
}

/*
 * CA-2-39: resolving a dispute as REFUND asked for the money back — or rather, it did not.
 *
 * `resolve()` wrote the dispute row and nothing else, so a manager choosing REFUND believed
 * the customer would be repaid and nothing repaid them. The only record was a status on a
 * queue nobody reconciles against the money.
 */
describe('DisputeService REFUND queues the money (CA-2-39)', () => {
  const raise = async (svc: DisputeService, depotId: string) =>
    svc.raise(
      {
        depotId,
        orderRef: 'HM-260902-001',
        customerName: 'Siti',
        category: DisputeCategory.WRONG_ITEM,
        description: 'galon bocor',
      },
      MANAGER,
    );

  it('queues a refund for the order, carrying the manager token', async () => {
    const depotRepo = new InMemoryDepotRepository();
    const refunds = new FakeDisputeRefund();
    const svc = new DisputeService(new InMemoryDisputeRepository(), depotRepo, refunds);
    const depot = await seedDepot(depotRepo);
    const d = await raise(svc, depot);

    const out = await svc.resolve(
      d.id,
      DisputeResolution.REFUND,
      'galon bocor',
      MANAGER,
      'Bearer t',
    );

    expect(out.status).toBe(DisputeStatus.RESOLVED);
    expect(refunds.calls).toEqual([
      { orderRef: 'HM-260902-001', reason: 'galon bocor', authorization: 'Bearer t' },
    ]);
  });

  /*
   * The heart of it. A dispute marked RESOLVED against a refund that was never queued is
   * the exact state this row is about, so the failure has to reach the manager while they
   * are still on the screen — and the dispute stays OPEN.
   */
  it('leaves the dispute OPEN when the refund could not be queued', async () => {
    const depotRepo = new InMemoryDepotRepository();
    const refunds = new FakeDisputeRefund();
    const repo = new InMemoryDisputeRepository();
    const svc = new DisputeService(repo, depotRepo, refunds);
    const depot = await seedDepot(depotRepo);
    const d = await raise(svc, depot);
    refunds.fail = 'pesanan HM-260902-001 tidak ditemukan';

    await expect(
      svc.resolve(d.id, DisputeResolution.REFUND, null, MANAGER, 'Bearer t'),
    ).rejects.toThrow(/tidak ditemukan/);

    expect((await svc.get(d.id)).status).toBe(DisputeStatus.OPEN);
  });

  /*
   * RESEND is deliberately NOT wired: creating a replacement order is a product decision,
   * not a plumbing one, and inventing one here would repeat the mistake in the other
   * direction. REJECTED moves no money by definition.
   */
  it.each([DisputeResolution.RESEND, DisputeResolution.REJECTED])(
    'moves no money for %s',
    async (resolution) => {
      const depotRepo = new InMemoryDepotRepository();
      const refunds = new FakeDisputeRefund();
      const svc = new DisputeService(new InMemoryDisputeRepository(), depotRepo, refunds);
      const depot = await seedDepot(depotRepo);
      const d = await raise(svc, depot);

      await svc.resolve(d.id, resolution, null, MANAGER, 'Bearer t');

      expect(refunds.calls).toEqual([]);
    },
  );

  it('falls back to the category when the manager left no note', async () => {
    const depotRepo = new InMemoryDepotRepository();
    const refunds = new FakeDisputeRefund();
    const svc = new DisputeService(new InMemoryDisputeRepository(), depotRepo, refunds);
    const depot = await seedDepot(depotRepo);
    const d = await raise(svc, depot);

    await svc.resolve(d.id, DisputeResolution.REFUND, '   ', MANAGER, 'Bearer t');

    // A refund with no reason at all is one nobody can review later.
    expect(refunds.calls[0]!.reason).toBe(`Sengketa ${DisputeCategory.WRONG_ITEM}`);
  });
});
