import { randomUUID } from 'node:crypto';

import { HandoverService } from '../../src/application/services/handover.service';
import { HandoverItemState, ShiftHandover } from '../../src/domain/handover';
import { DepotNotFoundError, HandoverNotFoundError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import {
  CreateHandoverData,
  HandoverRepository,
} from '../../src/application/ports/handover.repository';
import { InMemoryDepotRepository } from '../support/fakes';

const RECORDER = '11111111-1111-1111-1111-111111111111';

// Local in-memory fake — keeps this spec self-contained (does not touch test/support/fakes.ts).
class InMemoryHandoverRepository implements HandoverRepository {
  rows: ShiftHandover[] = [];
  private seq = 0;

  async create(data: CreateHandoverData): Promise<ShiftHandover> {
    const now = new Date(Date.now() + this.seq++); // monotonic for stable newest-first ordering
    const row: ShiftHandover = {
      id: randomUUID(),
      ...data,
      signedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string): Promise<ShiftHandover[]> {
    return this.rows
      .filter((r) => r.depotId === depotId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async findById(id: string): Promise<ShiftHandover | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async sign(id: string, signedAt: Date): Promise<ShiftHandover> {
    const row = this.rows.find((r) => r.id === id)!;
    row.signedAt = signedAt;
    return row;
  }
}

describe('HandoverService', () => {
  let repo: InMemoryHandoverRepository;
  let service: HandoverService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryHandoverRepository();
    service = new HandoverService(repo, depotRepo);
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

  const create = () =>
    service.record(
      {
        depotId,
        fromShift: 'Pagi',
        toShift: 'Sore',
        fromStaff: 'Budi',
        toStaff: 'Sari',
        items: [
          { title: 'Setoran kas', subtext: 'Rp 1.2jt', state: HandoverItemState.DONE },
          { title: 'Galon kosong', subtext: 'belum dihitung', state: HandoverItemState.PENDING },
        ],
      },
      RECORDER,
    );

  it('creates a handover storing its items, unsigned', async () => {
    const h = await create();
    expect(h.signedAt).toBeNull();
    expect(h.recordedBy).toBe(RECORDER);
    expect(h.items).toHaveLength(2);
    expect(h.items[0]).toEqual({
      title: 'Setoran kas',
      subtext: 'Rp 1.2jt',
      state: HandoverItemState.DONE,
    });
  });

  it('lists a depot handovers newest first', async () => {
    const first = await create();
    const second = await create();
    const all = await service.list(depotId);
    expect(all.map((h) => h.id)).toEqual([second.id, first.id]);
  });

  it('signs a handover, stamping signedAt', async () => {
    const h = await create();
    const signed = await service.sign(h.id);
    expect(signed.signedAt).toBeInstanceOf(Date);
  });

  it('throws NotFound signing a missing handover', async () => {
    await expect(service.sign(randomUUID())).rejects.toBeInstanceOf(HandoverNotFoundError);
  });

  it('rejects an unknown depot on record', async () => {
    await expect(
      service.record(
        {
          depotId: randomUUID(),
          fromShift: 'Pagi',
          toShift: 'Sore',
          fromStaff: 'A',
          toStaff: 'B',
          items: [],
        },
        RECORDER,
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});
