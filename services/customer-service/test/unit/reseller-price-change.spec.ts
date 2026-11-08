import { BadRequestException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { ResellerService } from '../../src/application/services/reseller.service';
import {
  Reseller,
  ResellerPriceChange,
  ResellerRepository,
} from '../../src/application/ports/reseller.repository';
import { NothingToScheduleError, ResellerNotFoundError } from '../../src/domain/errors';

/**
 * K4.2. Deactivating an agen and changing what they pay used to be a bare UPDATE:
 * instant, unsigned, unannounced. Every case here is one of those three silences.
 */

/*
 * A hard-coded future date is a fuse, and this one burned down on 2026-09-01.
 *
 * NEXT_MONTH was a month ahead when it was typed and the service reads the REAL clock, so
 * on the first of September "next month" became today: six tests that assert a scheduled
 * change has NOT been applied yet started finding it applied, on a pull request that touched
 * neither resellers nor pricing.
 *
 * The dates stay literal because they read well in the assertions; what changes is that the
 * clock is pinned to NOW for this suite, so NEXT_MONTH is a week ahead of "today" forever
 * rather than for as long as the calendar allowed.
 */
const NOW = new Date('2026-08-25T10:00:00.000Z');
const NEXT_MONTH = new Date('2026-09-01T00:00:00.000Z');

function row(over: Partial<Reseller> = {}): Reseller {
  return {
    customerId: 'c1',
    homeDepotId: 'd1',
    monthlyTargetQty: 100,
    discountPct: 10,
    flatGallonPriceIdr: 0,
    photoUrl: null,
    active: true,
    joinDate: new Date('2026-01-01'),
    note: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

const staff: AuthenticatedUser = {
  sub: 'staff-1',
  role: Role.HEAD_OFFICE,
  phone: null,
  depotId: null,
};

/** Repository that keeps the reseller row and the change log in memory. */
function build(opts: { updateFails?: boolean } = {}) {
  let current = row();
  const changes: ResellerPriceChange[] = [];
  const calls = { updateWithPriceChanges: 0 };
  let seq = 0;
  const repo: ResellerRepository = {
    list: async () => [current],
    findById: async () => current,
    create: async () => current,
    update: async (_id, patch) => {
      if (opts.updateFails) throw new Error('db down');
      current = { ...current, ...patch } as Reseller;
      return current;
    },
    recordPriceChange: async (data) => {
      seq += 1;
      const rec: ResellerPriceChange = { id: 'ch-' + seq, createdAt: NOW, ...data };
      changes.push(rec);
      return rec;
    },
    // CUS-03: profile + log are ONE operation. A failing write leaves neither behind.
    updateWithPriceChanges: async (_id, patch, logged) => {
      calls.updateWithPriceChanges += 1;
      if (opts.updateFails) throw new Error('db down');
      current = { ...current, ...patch } as Reseller;
      for (const data of logged) {
        seq += 1;
        changes.push({ id: 'ch-' + seq, createdAt: NOW, ...data });
      }
      return current;
    },
    // CUS-03: claim the rows (appliedAt IS NULL -> now) and move the profile atomically.
    // A row somebody else already claimed means this caller lost, and nothing moves.
    applyPriceChanges: async (_id, patch, ids, at) => {
      if (opts.updateFails) throw new Error('db down');
      const rows = ids.map((id) => changes.find((c) => c.id === id)!);
      if (rows.some((r) => r.appliedAt !== null)) return null;
      for (const r of rows) r.appliedAt = at;
      current = { ...current, ...patch } as Reseller;
      return current;
    },
    listPriceChanges: async () => [...changes].reverse(),
    findDuePriceChanges: async (now) =>
      changes.filter((c) => c.appliedAt === null && c.effectiveAt.getTime() <= now.getTime()),
  };

  const notices: { terms: string; active: boolean }[] = [];
  const notifier = {
    priceChanged: async (n: { terms: string; active: boolean }) => {
      notices.push({ terms: n.terms, active: n.active });
      return true;
    },
  };
  const profiles = { exists: async () => true, create: async () => ({}) };
  const identity = {
    getCustomerNames: async () => new Map(),
    preRegisterCustomer: async () => ({}),
  };

  const service = new ResellerService(
    repo,
    profiles as never,
    identity as never,
    notifier as never,
  );
  return { service, changes, notices, repo, calls, reseller: () => current };
}

describe('ResellerService price changes (K4.2)', () => {
  // The service asks the real clock, so the clock has to be told what day it is.
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('records who dropped the discount, from what, to what', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { discountPct: 5 });

    expect(t.changes).toHaveLength(1);
    expect(t.changes[0]).toMatchObject({
      changedBy: 'staff-1',
      field: 'discountPct',
      oldValue: '10',
      newValue: '5',
    });
    expect(t.changes[0].appliedAt).not.toBeNull();
  });

  it('tells the agen what they now pay instead of letting them find out at the till', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { flatGallonPriceIdr: 5000 });

    expect(t.notices).toEqual([{ terms: 'Rp 5.000 per galon', active: true }]);
  });

  it('says a deactivation is a deactivation, not a new rate', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { active: false });

    expect(t.notices).toEqual([
      { terms: 'harga agen dihentikan (kembali ke harga umum)', active: false },
    ]);
    expect(t.changes[0]).toMatchObject({ field: 'active', oldValue: 'true', newValue: 'false' });
  });

  it('records one row per field, not one per request', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { discountPct: 0, active: false });

    expect(t.changes.map((c) => c.field).sort()).toEqual(['active', 'discountPct']);
  });

  it('stays quiet about edits that are not a price', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { note: 'pindah toko', monthlyTargetQty: 200 });

    expect(t.changes).toHaveLength(0);
    expect(t.notices).toHaveLength(0);
  });

  it('does not record a patch that changes nothing', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { discountPct: 10 });

    expect(t.changes).toHaveLength(0);
    expect(t.notices).toHaveLength(0);
  });

  it('reports the general price when both the percent and the flat rate are zero', async () => {
    const t = build();

    await t.service.update(staff, 'c1', { discountPct: 0 });

    expect(t.notices).toEqual([{ terms: 'harga umum (tanpa diskon agen)', active: true }]);
  });

  describe('scheduling', () => {
    it('leaves today alone when the change is dated for next month', async () => {
      const t = build();

      const returned = await t.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);

      // The agen keeps today's terms until the date they were told about.
      expect(returned.discountPct).toBe(10);
      expect(t.reseller().discountPct).toBe(10);
      expect(t.changes[0]).toMatchObject({ effectiveAt: NEXT_MONTH, appliedAt: null });
      // Nothing has happened yet, so nothing is announced yet.
      expect(t.notices).toHaveLength(0);
    });

    it('applies it once when the day comes, and tells the agen then', async () => {
      const t = build();
      await t.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);

      const first = await t.service.applyScheduled(new Date('2026-09-01T01:00:00.000Z'));
      const second = await t.service.applyScheduled(new Date('2026-09-01T02:00:00.000Z'));

      expect(first).toMatchObject({ ok: true, due: 1, applied: 1 });
      expect(second).toMatchObject({ ok: true, due: 0, applied: 0 });
      expect(t.reseller().discountPct).toBe(5);
      expect(t.notices).toEqual([{ terms: 'diskon 5%', active: true }]);
    });

    it('does not apply it early', async () => {
      const t = build();
      await t.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);

      const result = await t.service.applyScheduled(new Date('2026-08-31T23:00:00.000Z'));

      expect(result).toMatchObject({ due: 0, applied: 0 });
      expect(t.reseller().discountPct).toBe(10);
    });

    it('sends ONE notice when two fields land on the same morning', async () => {
      const t = build();
      await t.service.update(staff, 'c1', { discountPct: 0, flatGallonPriceIdr: 5000 }, NEXT_MONTH);

      await t.service.applyScheduled(new Date('2026-09-01T01:00:00.000Z'));

      expect(t.reseller()).toMatchObject({ discountPct: 0, flatGallonPriceIdr: 5000 });
      expect(t.notices).toEqual([{ terms: 'Rp 5.000 per galon', active: true }]);
    });

    it('applies a scheduled deactivation as a boolean, not the string false', async () => {
      const t = build();
      await t.service.update(staff, 'c1', { active: false }, NEXT_MONTH);

      await t.service.applyScheduled(new Date('2026-09-01T01:00:00.000Z'));

      expect(t.reseller().active).toBe(false);
    });

    it('refuses a date with no price change behind it, rather than scheduling nothing', async () => {
      const t = build();

      await expect(
        t.service.update(staff, 'c1', { note: 'catatan saja' }, NEXT_MONTH),
      ).rejects.toBeInstanceOf(NothingToScheduleError);
      expect(t.changes).toHaveLength(0);
    });

    it('treats a date already in the past as now', async () => {
      const t = build();

      await t.service.update(staff, 'c1', { discountPct: 5 }, new Date('2020-01-01'));

      expect(t.reseller().discountPct).toBe(5);
      expect(t.changes[0].appliedAt).not.toBeNull();
    });

    it('leaves a failed change DUE and reports the dead round (J7)', async () => {
      const broken = build({ updateFails: true });
      await broken.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);

      const result = await broken.service.applyScheduled(new Date('2026-09-01T01:00:00.000Z'));

      expect(result).toMatchObject({ ok: false, due: 1, applied: 0 });
      expect(broken.changes[0].appliedAt).toBeNull();
      expect(broken.notices).toHaveLength(0);
    });
  });

  it('hands back the history newest first, applied and pending alike', async () => {
    const t = build();
    await t.service.update(staff, 'c1', { discountPct: 5 });
    await t.service.update(staff, 'c1', { flatGallonPriceIdr: 5000 }, NEXT_MONTH);

    const history = await t.service.priceHistory(staff, 'c1');

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ field: 'flatGallonPriceIdr', appliedAt: null });
    expect(history[1]).toMatchObject({ field: 'discountPct' });
  });

  it('refuses the history of somebody who is not an agen', async () => {
    const t = build();
    // The guard before the depot check: asking for a stranger must not reach the data.
    t.repo.findById = async () => null;
    await expect(t.service.priceHistory(staff, 'nobody')).rejects.toBeInstanceOf(
      ResellerNotFoundError,
    );
  });

  it('sweeps with the real clock when no date is passed', async () => {
    const t = build();
    // `applyScheduled(now = new Date())` — the cron calls it with nothing, and the default
    // had never been exercised. Fake timers hold "now" at NOW, so a change dated next month
    // is correctly not due.
    await t.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);
    const result = await t.service.applyScheduled();
    expect(result.applied).toBe(0);
  });
});

/** The BadRequest mapping the controller puts on top of NothingToScheduleError. */
describe('NothingToScheduleError', () => {
  it('is a 400, not a silent 200', () => {
    expect(new BadRequestException(new NothingToScheduleError().message).getStatus()).toBe(400);
  });
});

describe('CUS-03 · the price audit trail cannot come apart from the price', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes the profile and its log in one repository call', async () => {
    const t = build();
    await t.service.update(staff, 'c1', { discountPct: 5, active: false });
    expect(t.calls.updateWithPriceChanges).toBe(1);
    expect(t.changes.map((c) => c.field).sort()).toEqual(['active', 'discountPct']);
  });

  it('a failed write leaves neither a changed price nor a log row, and announces nothing', async () => {
    const t = build({ updateFails: true });
    await expect(t.service.update(staff, 'c1', { discountPct: 5 })).rejects.toThrow('db down');
    expect(t.reseller().discountPct).toBe(10);
    expect(t.changes).toHaveLength(0);
    expect(t.notices).toHaveLength(0);
  });

  it('a non-price edit does not open the logging path at all', async () => {
    const t = build();
    await t.service.update(staff, 'c1', { note: 'pindah toko' });
    expect(t.calls.updateWithPriceChanges).toBe(0);
  });

  it('two overlapping sweeps apply and announce a due change exactly once', async () => {
    const t = build();
    await t.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);
    const at = new Date('2026-09-01T01:00:00.000Z');
    const [a, b] = await Promise.all([t.service.applyScheduled(at), t.service.applyScheduled(at)]);
    expect(a.applied + b.applied).toBe(1);
    expect(t.reseller().discountPct).toBe(5);
    expect(t.notices).toHaveLength(1);
  });

  it('a sweep that lost the claim does not overwrite a newer manual change', async () => {
    const t = build();
    await t.service.update(staff, 'c1', { discountPct: 5 }, NEXT_MONTH);
    const at = new Date('2026-09-01T01:00:00.000Z');
    await t.service.applyScheduled(at);
    // Staff then set the discount by hand, later than the schedule.
    await t.service.update(staff, 'c1', { discountPct: 8 });
    // A tick that was already holding the old due list runs again: the row is claimed, so it
    // moves nothing.
    jest.spyOn(t.repo, 'findDuePriceChanges').mockResolvedValue(
      t.changes.filter((c) => c.effectiveAt.getTime() === NEXT_MONTH.getTime()),
    );
    const late = await t.service.applyScheduled(at);
    expect(late.applied).toBe(0);
    expect(t.reseller().discountPct).toBe(8);
  });
});
