import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '@hydromart/platform';

import {
  CloseDayData,
  DailyCloseRecord,
  DailyCloseRepository,
} from '../../src/application/ports/daily-close.repository';
import {
  CloseMonthData,
  MonthlyCloseRecord,
  MonthlyCloseRepository,
} from '../../src/application/ports/monthly-close.repository';
import { MonthlyCloseService } from '../../src/application/services/monthly-close.service';
import { InMemoryDepotRepository } from '../support/fakes';
import { OwnershipType } from '../../src/domain/inventory';

class FakeDailyCloses implements DailyCloseRepository {
  rows: DailyCloseRecord[] = [];
  async find(depotId: string, businessDate: string) {
    return this.rows.find((r) => r.depotId === depotId && r.businessDate === businessDate) ?? null;
  }
  async close(data: CloseDayData) {
    const row: DailyCloseRecord = {
      id: randomUUID(),
      ...data,
      closedAt: new Date(),
      reopenedAt: null,
      reopenedBy: null,
    };
    this.rows.push(row);
    return row;
  }
  async reopen(depotId: string, businessDate: string, reopenedBy: string) {
    const row = (await this.find(depotId, businessDate))!;
    row.reopenedAt = new Date();
    row.reopenedBy = reopenedBy;
    return row;
  }
  async listForDepotRange(depotId: string, from: Date, to: Date) {
    return this.rows.filter(
      (r) =>
        r.depotId === depotId && new Date(r.businessDate) >= from && new Date(r.businessDate) < to,
    );
  }
  /** Test helper: push a closed day straight in, skipping the real close() math. */
  seed(depotId: string, businessDate: string, overrides: Partial<DailyCloseRecord> = {}): void {
    this.rows.push({
      id: randomUUID(),
      depotId,
      businessDate,
      closedAt: new Date(`${businessDate}T10:00:00Z`),
      closedBy: 'kd-1',
      cashInIdr: 100_000,
      cashOutIdr: 10_000,
      konterIdr: 60_000,
      codDepositedIdr: 40_000,
      codExpectedIdr: 40_000,
      note: null,
      reopenedAt: null,
      reopenedBy: null,
      ...overrides,
    });
  }
}

class FakeMonthlyCloses implements MonthlyCloseRepository {
  rows: MonthlyCloseRecord[] = [];
  async find(depotId: string, businessMonth: string) {
    return (
      this.rows.find((r) => r.depotId === depotId && r.businessMonth === businessMonth) ?? null
    );
  }
  async close(data: CloseMonthData) {
    const existing = await this.find(data.depotId, data.businessMonth);
    const row: MonthlyCloseRecord = {
      id: existing?.id ?? randomUUID(),
      ...data,
      closedAt: new Date(),
      reopenedAt: null,
      reopenedBy: null,
    };
    this.rows = this.rows.filter((r) => r.id !== row.id).concat(row);
    return row;
  }
  async reopen(depotId: string, businessMonth: string, reopenedBy: string) {
    const row = (await this.find(depotId, businessMonth))!;
    row.reopenedAt = new Date();
    row.reopenedBy = reopenedBy;
    return row;
  }
  async findSealing(depotId: string, businessDate: string) {
    const month = businessDate.slice(0, 7);
    return (
      this.rows.find((r) => r.depotId === depotId && r.businessMonth === month && !r.reopenedAt) ??
      null
    );
  }
}

function make() {
  const dailyCloses = new FakeDailyCloses();
  const monthlyCloses = new FakeMonthlyCloses();
  const depots = new InMemoryDepotRepository();
  const service = new MonthlyCloseService(
    monthlyCloses,
    dailyCloses,
    depots as never,
    { businessTimeZone: 'Asia/Jakarta' } as never,
  );
  return { dailyCloses, monthlyCloses, depots, service };
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

/** Every YYYY-MM-DD in July 2026 (31 days) — a month fully in the past, so "up to today" is moot. */
function julyDays(): string[] {
  return Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
}

describe('MonthlyCloseService', () => {
  describe('close', () => {
    it('refuses a month with no day closed yet, and names every missing day', async () => {
      const { service, depots } = make();
      const depotId = await seedDepot(depots);

      await expect(service.close(kepalaDepot(depotId), depotId, '2026-07', null)).rejects.toThrow(
        /31 hari belum ditutup/,
      );
    });

    it('caps the named days and counts the rest', async () => {
      const { service, depots } = make();
      const depotId = await seedDepot(depots);

      await expect(service.close(kepalaDepot(depotId), depotId, '2026-07', null)).rejects.toThrow(
        /2026-07-01, 2026-07-02, 2026-07-03, 2026-07-04, 2026-07-05 dan 26 lainnya/,
      );
    });

    it('refuses while even one day of the month is still open', async () => {
      const { service, depots, dailyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays().slice(0, 30)) dailyCloses.seed(depotId, d);
      // The 31st was closed, then reopened — still counts as open.
      dailyCloses.seed(depotId, '2026-07-31', { reopenedAt: new Date() });

      await expect(service.close(kepalaDepot(depotId), depotId, '2026-07', null)).rejects.toThrow(
        /1 hari belum ditutup: 2026-07-31/,
      );
    });

    it('seals the month once every day is closed, summing their figures', async () => {
      const { service, depots, dailyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays()) dailyCloses.seed(depotId, d);

      const sealed = await service.close(kepalaDepot(depotId), depotId, '2026-07', 'bulan beres');

      expect(sealed.daysClosed).toBe(31);
      expect(sealed.cashInIdr).toBe(100_000 * 31);
      expect(sealed.codDepositedIdr).toBe(40_000 * 31);
      expect(sealed.note).toBe('bulan beres');
      expect(sealed.closedBy).toBe('kd-1');
    });

    it('refuses to seal the same month twice', async () => {
      const { service, depots, dailyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays()) dailyCloses.seed(depotId, d);
      await service.close(kepalaDepot(depotId), depotId, '2026-07', null);

      await expect(service.close(kepalaDepot(depotId), depotId, '2026-07', null)).rejects.toThrow(
        /Bulan ini sudah ditutup/,
      );
    });

    it('refuses a month entirely in the future: nothing to seal yet', async () => {
      const { service, depots } = make();
      const depotId = await seedDepot(depots);

      await expect(service.close(kepalaDepot(depotId), depotId, '2099-01', null)).rejects.toThrow(
        /Belum ada hari/,
      );
    });

    it('only requires days up to TODAY for the month in progress, not the whole calendar month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-10T03:00:00Z')); // 10:00 WIB, 10 Jul
      try {
        const { service, depots, dailyCloses } = make();
        const depotId = await seedDepot(depots);
        // Only the 1st through the 10th — the rest of July has not happened yet.
        for (const d of julyDays().slice(0, 10)) dailyCloses.seed(depotId, d);

        const sealed = await service.close(kepalaDepot(depotId), depotId, '2026-07', null);
        expect(sealed.daysClosed).toBe(10);
      } finally {
        jest.useRealTimers();
      }
    });

    it('refuses an invalid month shape', async () => {
      const { service, depots } = make();
      const depotId = await seedDepot(depots);
      await expect(
        service.close(kepalaDepot(depotId), depotId, '2026-7', null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a depot that does not exist', async () => {
      const { service } = make();
      const depotId = randomUUID(); // never seeded
      await expect(service.close(kepalaDepot(depotId), depotId, '2026-07', null)).rejects.toThrow();
    });

    it('rolls a December close into next January without crossing years wrong', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-01-05T03:00:00Z')); // after December ended
      try {
        const { service, depots, dailyCloses } = make();
        const depotId = await seedDepot(depots);
        const decDays = Array.from(
          { length: 31 },
          (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`,
        );
        for (const d of decDays) dailyCloses.seed(depotId, d);

        const sealed = await service.close(kepalaDepot(depotId), depotId, '2026-12', null);
        expect(sealed.daysClosed).toBe(31);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('get', () => {
    it('reports every missing day before the month is sealed', async () => {
      const { service, depots, dailyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays().slice(0, 29)) dailyCloses.seed(depotId, d);

      const view = await service.get(kepalaDepot(depotId), depotId, '2026-07');
      expect(view.close).toBeNull();
      expect(view.missingDays).toEqual(['2026-07-30', '2026-07-31']);
    });

    it('reports no missing days for a month entirely in the future — nothing to report yet', async () => {
      const { service, depots } = make();
      const depotId = await seedDepot(depots);

      const view = await service.get(kepalaDepot(depotId), depotId, '2099-01');
      expect(view.close).toBeNull();
      expect(view.missingDays).toEqual([]);
    });

    it('reports the seal and no missing days once sealed', async () => {
      const { service, depots, dailyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays()) dailyCloses.seed(depotId, d);
      await service.close(kepalaDepot(depotId), depotId, '2026-07', null);

      const view = await service.get(kepalaDepot(depotId), depotId, '2026-07');
      expect(view.close?.daysClosed).toBe(31);
      expect(view.missingDays).toEqual([]);
    });
  });

  describe('reopen', () => {
    it('refuses a month never closed', async () => {
      const { service, depots } = make();
      const depotId = await seedDepot(depots);
      await expect(service.reopen(depotId, '2026-07', 'hq-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reopens a sealed month, and lets it be sealed again', async () => {
      const { service, depots, dailyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays()) dailyCloses.seed(depotId, d);
      await service.close(kepalaDepot(depotId), depotId, '2026-07', null);

      const reopened = await service.reopen(depotId, '2026-07', 'hq-1');
      expect(reopened.reopenedBy).toBe('hq-1');
      expect(reopened.reopenedAt).toBeInstanceOf(Date);

      const resealed = await service.close(kepalaDepot(depotId), depotId, '2026-07', 'ulang');
      expect(resealed.reopenedAt).toBeNull();
    });

    it('returns an already-reopened month untouched (idempotent)', async () => {
      const { service, depots, dailyCloses, monthlyCloses } = make();
      const depotId = await seedDepot(depots);
      for (const d of julyDays()) dailyCloses.seed(depotId, d);
      await service.close(kepalaDepot(depotId), depotId, '2026-07', null);
      await service.reopen(depotId, '2026-07', 'hq-1');
      const row = monthlyCloses.rows[0]!;
      const reopenedAt = row.reopenedAt;

      const again = await service.reopen(depotId, '2026-07', 'hq-2');
      expect(again.reopenedBy).toBe('hq-1'); // unchanged — the second call did nothing
      expect(again.reopenedAt).toBe(reopenedAt);
    });
  });
});
