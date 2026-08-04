import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '@hydromart/platform';

import { CashbookEntry, CashDirection } from '../../src/domain/cashbook';
import {
  CashbookDateRange,
  CashbookRepository,
  CreateCashbookEntryData,
} from '../../src/application/ports/cashbook.repository';
import {
  CloseDayData,
  DailyCloseRecord,
  DailyCloseRepository,
} from '../../src/application/ports/daily-close.repository';
import { DailyCloseService } from '../../src/application/services/daily-close.service';
import { InMemoryDepotRepository } from '../support/fakes';
import { OwnershipType } from '../../src/domain/inventory';

const DAY = '2026-08-04';

class FakeCashbook implements CashbookRepository {
  rows: CashbookEntry[] = [];
  async create(data: CreateCashbookEntryData): Promise<CashbookEntry> {
    const row: CashbookEntry = { id: randomUUID(), ...data, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, range: CashbookDateRange): Promise<CashbookEntry[]> {
    return this.rows.filter(
      (r) =>
        r.depotId === depotId &&
        (!range.from || r.occurredAt >= range.from) &&
        (!range.to || r.occurredAt < range.to),
    );
  }
}

class FakeCloses implements DailyCloseRepository {
  rows: DailyCloseRecord[] = [];
  async find(depotId: string, businessDate: string) {
    return this.rows.find((r) => r.depotId === depotId && r.businessDate === businessDate) ?? null;
  }
  async close(data: CloseDayData) {
    const existing = await this.find(data.depotId, data.businessDate);
    const row: DailyCloseRecord = {
      id: existing?.id ?? randomUUID(),
      ...data,
      closedAt: new Date(),
      reopenedAt: null,
      reopenedBy: null,
    };
    this.rows = this.rows.filter((r) => r.id !== row.id).concat(row);
    return row;
  }
  async reopen(depotId: string, businessDate: string, reopenedBy: string) {
    const row = (await this.find(depotId, businessDate))!;
    row.reopenedAt = new Date();
    row.reopenedBy = reopenedBy;
    return row;
  }
}

/** Open cashier shifts, the one thing that can refuse a close. */
class FakeShifts {
  open: unknown[] = [];
  async listOpen() {
    return this.open;
  }
}

function make(cod = { depositedIdr: 500_000, expectedIdr: 520_000, settlements: 3 }) {
  const cashbook = new FakeCashbook();
  const closes = new FakeCloses();
  const shifts = new FakeShifts();
  const depots = new InMemoryDepotRepository();
  const service = new DailyCloseService(
    closes,
    cashbook,
    shifts as never,
    depots as never,
    { depositedInWindow: async () => cod } as never,
  );
  return { cashbook, closes, shifts, depots, service };
}

async function seedDepot(depots: InMemoryDepotRepository): Promise<string> {
  const depot = await depots.create({
    code: 'JKT-01',
    name: 'Depot Satu',
    address: 'Jl. Satu',
    city: 'Jakarta',
    province: 'DKI',
    ownershipType: OwnershipType.HKP,
  } as never);
  return depot.id;
}

const kepalaDepot = (depotId: string): AuthenticatedUser =>
  ({ sub: 'kd-1', role: 'KEPALA_DEPOT', phone: '0811', depotId }) as never;

describe('DailyCloseService', () => {
  it('adds up both halves of the day: counter cash from the cashbook, COD from delivery', async () => {
    const { cashbook, service, depots } = make();
    const depotId = await seedDepot(depots);
    const at = new Date(`${DAY}T03:00:00.000Z`);
    await cashbook.create({
      depotId,
      direction: CashDirection.IN,
      category: 'KONTER',
      label: 'Tunai konter',
      amountIdr: 300_000,
      occurredAt: at,
      sourceRef: null,
      actorId: 'kd-1',
    });
    await cashbook.create({
      depotId,
      direction: CashDirection.OUT,
      category: 'PO',
      label: 'Beli tutup galon',
      amountIdr: 50_000,
      occurredAt: at,
      sourceRef: null,
      actorId: 'kd-1',
    });

    const closed = await service.close(kepalaDepot(depotId), depotId, DAY, 'sudah dihitung');

    expect(closed).toMatchObject({
      businessDate: DAY,
      cashInIdr: 300_000,
      cashOutIdr: 50_000,
      konterIdr: 300_000,
      // Courier money the counter never saw — the half that used to be missing entirely.
      codDepositedIdr: 500_000,
      codExpectedIdr: 520_000,
      note: 'sudah dihitung',
    });
  });

  // The counter is still taking money into a day somebody is calling finished.
  it('refuses to close while a cashier shift is still open', async () => {
    const { shifts, service, depots } = make();
    const depotId = await seedDepot(depots);
    shifts.open = [{ id: 'shift-1' }];

    await expect(service.close(kepalaDepot(depotId), depotId, DAY, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to close the same day twice', async () => {
    const { service, depots } = make();
    const depotId = await seedDepot(depots);
    await service.close(kepalaDepot(depotId), depotId, DAY, null);

    await expect(service.close(kepalaDepot(depotId), depotId, DAY, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Money that arrives after the book is shut still exists. Reporting it beats refusing it:
  // a rejected entry means cash in a drawer with no record at all.
  it('counts entries that arrive after the close instead of hiding them', async () => {
    const { cashbook, service, depots } = make();
    const depotId = await seedDepot(depots);
    await service.close(kepalaDepot(depotId), depotId, DAY, null);

    const late = await cashbook.create({
      depotId,
      direction: CashDirection.IN,
      category: 'COD',
      label: 'Setoran kurir telat',
      occurredAt: new Date(`${DAY}T22:00:00.000Z`), // dated inside the closed day
      amountIdr: 75_000,
      sourceRef: null,
      actorId: 'kd-1',
    });
    // Recorded a minute after the book was shut; the fake would otherwise stamp both in
    // the same millisecond, which never happens with a human in the loop.
    cashbook.rows.find((r) => r.id === late.id)!.createdAt = new Date(Date.now() + 60_000);

    const view = await service.get(kepalaDepot(depotId), depotId, DAY);
    expect(view.lateEntries).toBe(1);
    expect(view.lateAmountIdr).toBe(75_000);
  });

  it('reports an unclosed day as unclosed rather than failing', async () => {
    const { service, depots } = make();
    const depotId = await seedDepot(depots);

    await expect(service.get(kepalaDepot(depotId), depotId, DAY)).resolves.toEqual({
      close: null,
      lateEntries: 0,
      lateAmountIdr: 0,
    });
  });

  // Reopening keeps the row and marks it — who reopened it is the question people ask.
  it('reopens a closed day, and lets it be closed again with fresh numbers', async () => {
    const { service, depots, closes } = make();
    const depotId = await seedDepot(depots);
    await service.close(kepalaDepot(depotId), depotId, DAY, null);

    const reopened = await service.reopen(depotId, DAY, 'hq-1');
    expect(reopened.reopenedBy).toBe('hq-1');
    expect(reopened.reopenedAt).toBeInstanceOf(Date);

    const reclosed = await service.close(kepalaDepot(depotId), depotId, DAY, 'dihitung ulang');
    expect(reclosed.reopenedAt).toBeNull();
    expect(closes.rows).toHaveLength(1); // one day, one row
  });

  it('refuses to reopen a day nobody closed', async () => {
    const { service, depots } = make();
    const depotId = await seedDepot(depots);

    await expect(service.reopen(depotId, DAY, 'hq-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
