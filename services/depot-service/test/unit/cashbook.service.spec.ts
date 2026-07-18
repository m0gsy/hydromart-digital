import { randomUUID } from 'node:crypto';

import { CashbookService } from '../../src/application/services/cashbook.service';
import { CashbookEntry, CashDirection } from '../../src/domain/cashbook';
import { DepotNotFoundError } from '../../src/domain/errors';
import {
  CashbookDateRange,
  CashbookRepository,
  CreateCashbookEntryData,
} from '../../src/application/ports/cashbook.repository';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import { InMemoryDepotRepository } from '../support/fakes';

const ACTOR = '11111111-1111-1111-1111-111111111111';

class InMemoryCashbookRepository implements CashbookRepository {
  rows: CashbookEntry[] = [];

  async create(data: CreateCashbookEntryData): Promise<CashbookEntry> {
    const row: CashbookEntry = { id: randomUUID(), ...data, createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }

  async listForDepot(depotId: string, range: CashbookDateRange): Promise<CashbookEntry[]> {
    return this.rows
      .filter((r) => r.depotId === depotId)
      .filter(
        (r) =>
          (!range.from || r.occurredAt >= range.from) && (!range.to || r.occurredAt <= range.to),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((r) => ({ ...r }));
  }
}

describe('CashbookService', () => {
  let service: CashbookService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    service = new CashbookService(new InMemoryCashbookRepository(), depotRepo);
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

  const post = (direction: CashDirection, amountIdr: number, occurredAt?: Date) =>
    service.record(
      { depotId, direction, category: 'COD', label: 'test', amountIdr, occurredAt },
      ACTOR,
    );

  it('records an entry stamping the actor and defaulting occurredAt', async () => {
    const entry = await post(CashDirection.IN, 250_000);
    expect(entry.actorId).toBe(ACTOR);
    expect(entry.occurredAt).toBeInstanceOf(Date);
    expect(entry.sourceRef).toBeNull();
  });

  it('summarizes in/out/net over the entries, newest first', async () => {
    await post(CashDirection.IN, 250_000, new Date('2026-07-01T08:00:00Z'));
    await post(CashDirection.IN, 100_000, new Date('2026-07-02T08:00:00Z'));
    await post(CashDirection.OUT, 120_000, new Date('2026-07-03T08:00:00Z'));

    const { entries, summary } = await service.list(depotId);
    expect(summary.inIdr).toBe(350_000);
    expect(summary.outIdr).toBe(120_000);
    expect(summary.netIdr).toBe(230_000);
    // newest occurredAt first
    expect(entries[0].amountIdr).toBe(120_000);
    expect(entries[2].amountIdr).toBe(250_000);
  });

  it('summarizes only the date-filtered rows', async () => {
    await post(CashDirection.IN, 250_000, new Date('2026-07-01T08:00:00Z'));
    await post(CashDirection.OUT, 120_000, new Date('2026-07-10T08:00:00Z'));

    const { entries, summary } = await service.list(depotId, {
      from: new Date('2026-07-05T00:00:00Z'),
    });
    expect(entries).toHaveLength(1);
    expect(summary.inIdr).toBe(0);
    expect(summary.outIdr).toBe(120_000);
    expect(summary.netIdr).toBe(-120_000);
  });

  it('rejects an unknown depot on record', async () => {
    await expect(
      service.record(
        {
          depotId: '00000000-0000-0000-0000-000000000000',
          direction: CashDirection.IN,
          category: 'COD',
          label: 'x',
          amountIdr: 1,
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});
