import { randomUUID } from 'node:crypto';

import { DisputeService } from '../../src/application/services/dispute.service';
import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../src/domain/order-dispute';
import { DisputeAlreadyResolvedError, DisputeNotFoundError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import {
  CreateDisputeData,
  DisputeRepository,
  UpdateDisputeData,
} from '../../src/application/ports/dispute.repository';
import { InMemoryDepotRepository } from '../support/fakes';

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

describe('DisputeService', () => {
  let repo: InMemoryDisputeRepository;
  let service: DisputeService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryDisputeRepository();
    service = new DisputeService(repo, depotRepo);
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
    const refunded = await service.resolve(a.id, DisputeResolution.REFUND, 'Dana dikembalikan', MANAGER);
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
      service.resolve('00000000-0000-0000-0000-000000000000', DisputeResolution.REFUND, null, MANAGER),
    ).rejects.toBeInstanceOf(DisputeNotFoundError);
  });
});
