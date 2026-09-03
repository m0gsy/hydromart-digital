import { randomUUID } from 'node:crypto';

import { CashbookService, RecordCashInput } from '../../src/application/services/cashbook.service';
import { CashbookEntry, CashDirection } from '../../src/domain/cashbook';
import {
  CashbookAlreadyReversedError,
  CashbookCannotReverseReversalError,
  CashbookEntryNotFoundError,
  DepotNotFoundError,
} from '../../src/domain/errors';
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
    const row: CashbookEntry = {
      id: randomUUID(),
      ...data,
      // CA-2-22: absent means an ordinary posting, which is what every entry was before
      // corrections existed.
      reversesId: data.reversesId ?? null,
      reversalReason: data.reversalReason ?? null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return { ...row };
  }

  async findById(id: string): Promise<CashbookEntry | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findReversalOf(id: string): Promise<CashbookEntry | null> {
    return this.rows.find((r) => r.reversesId === id) ?? null;
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

/** CA-2-22: its own repo and depot, so the corrections block does not lean on outer state. */
async function build(): Promise<{
  service: CashbookService;
  repo: InMemoryCashbookRepository;
  depotId: string;
}> {
  const depotRepo = new InMemoryDepotRepository();
  const repo = new InMemoryCashbookRepository();
  const service = new CashbookService(repo, depotRepo);
  const depot = await new DepotService(depotRepo).create({
    code: 'JKT-22',
    name: 'Depot Koreksi',
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
  return { service, repo, depotId: depot.id };
}

/*
 * CA-2-22: the depot cashbook had no correction path of any kind.
 *
 * The controller offered exactly two routes — POST to record and GET to list. No PATCH, no
 * DELETE, no reversal. A depot that typed Rp 5.000.000 where it meant Rp 500.000 had no way
 * to put it right, and the book stayed wrong for as long as it existed while the daily
 * close and every report above it read from that same book.
 *
 * The fix is NOT an edit. A ledger you can edit is a ledger nobody can audit: the number
 * changes and the fact that it changed does not survive.
 */
describe('CashbookService.reverse (CA-2-22)', () => {
  const post = (svc: CashbookService, depot: string, over: Partial<RecordCashInput> = {}) =>
    svc.record(
      {
        depotId: depot,
        direction: CashDirection.IN,
        category: 'COD',
        label: 'Setoran kurir',
        amountIdr: 5_000_000,
        ...over,
      },
      ACTOR,
    );

  it('posts the opposite leg and leaves the original exactly as it was', async () => {
    const { service, repo, depotId: depot } = await build();
    const original = await post(service, depot);

    const correction = await service.reverse(original.id, 'Salah ketik: seharusnya 500.000', ACTOR);

    expect(correction.direction).toBe(CashDirection.OUT);
    expect(correction.amountIdr).toBe(5_000_000);
    expect(correction.reversesId).toBe(original.id);
    expect(correction.reversalReason).toBe('Salah ketik: seharusnya 500.000');
    // History survives: the original is still there, still an IN, still 5.000.000.
    const kept = await repo.findById(original.id);
    expect(kept).toMatchObject({ direction: CashDirection.IN, amountIdr: 5_000_000 });
    expect(kept!.reversesId).toBeNull();
  });

  /* The other leg: an OUT is cancelled by an IN, or a mistaken expense stays on the books. */
  it('cancels an OUT with an IN', async () => {
    const { service, depotId: depot } = await build();
    const original = await post(service, depot, { direction: CashDirection.OUT, category: 'SEWA' });

    const correction = await service.reverse(original.id, 'dobel bayar', ACTOR);

    expect(correction.direction).toBe(CashDirection.IN);
  });

  it('nets the book back to zero', async () => {
    const { service, depotId: depot } = await build();
    const original = await post(service, depot);
    await service.reverse(original.id, 'salah', ACTOR);

    const { summary } = await service.list(depot);
    expect(summary.inIdr - summary.outIdr).toBe(0);
  });

  /*
   * A second correction — a retried request, or two operators pressing the button
   * together — would leave the book wrong in the OTHER direction: the same bug with a
   * minus sign. The partial unique index is the real defence; this is the readable half.
   */
  it('refuses to correct the same entry twice', async () => {
    const { service, depotId: depot } = await build();
    const original = await post(service, depot);
    await service.reverse(original.id, 'salah', ACTOR);

    await expect(service.reverse(original.id, 'salah lagi', ACTOR)).rejects.toBeInstanceOf(
      CashbookAlreadyReversedError,
    );
  });

  /*
   * Undoing a correction is posting the original again, which the ordinary record path
   * already does. Chains would make the book a puzzle: three entries where two would do,
   * and no reader able to say which one is live.
   */
  it('refuses to correct a correction', async () => {
    const { service, depotId: depot } = await build();
    const original = await post(service, depot);
    const correction = await service.reverse(original.id, 'salah', ACTOR);

    await expect(service.reverse(correction.id, 'batal', ACTOR)).rejects.toBeInstanceOf(
      CashbookCannotReverseReversalError,
    );
  });

  it('refuses an entry that does not exist', async () => {
    const { service } = await build();
    await expect(
      service.reverse('99999999-9999-4999-8999-999999999999', 'x', ACTOR),
    ).rejects.toBeInstanceOf(CashbookEntryNotFoundError);
  });
});
