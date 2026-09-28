import { GallonNetworkService } from '../../src/application/services/gallon-network.service';
import {
  GallonIssueDepotRow,
  GallonIssueRepository,
} from '../../src/application/ports/gallon-issue.repository';
import {
  GallonReturnDepotRow,
  GallonReturnRepository,
} from '../../src/application/ports/gallon-return.repository';
import { DepotRepository } from '../../src/application/ports/depot.repository';
import { DepotConfigService } from '../../src/config/depot-config.service';

// The limit is the depot's own tunable; a plain 14 keeps these tests about the arithmetic.
const config = { gallonMaxHoldDays: () => 14 } as unknown as DepotConfigService;

// Only networkSummary() is exercised; the rest of each repo port is irrelevant to the
// rollup, so the fakes stub just that one method.
const issues = (rows: GallonIssueDepotRow[]) =>
  ({ networkSummary: async () => rows }) as unknown as GallonIssueRepository;
const returns = (rows: GallonReturnDepotRow[]) =>
  ({ networkSummary: async () => rows }) as unknown as GallonReturnRepository;
// I5's `forCustomer` names each depot, so the service reads the depot repo too. The rollup
// tests below never reach that path; this stub exists so they can keep not caring.
/*
 * Both reads are counted. The customer deposit card used to call `findById` once per depot
 * — an N+1 that is invisible on seed data because N is "how many depots has this person
 * used". Counting is the only way a test can tell one batched read from three single ones,
 * since the RESULT is identical either way.
 */
const depotCalls = { findById: 0, findManyByIds: 0 };
const depots = (byId: Record<string, string> = {}) => {
  depotCalls.findById = 0;
  depotCalls.findManyByIds = 0;
  return {
    findById: async (id: string) => {
      depotCalls.findById += 1;
      return byId[id] ? { id, name: byId[id] } : null;
    },
    findManyByIds: async (ids: string[]) => {
      depotCalls.findManyByIds += 1;
      return ids.filter((id) => byId[id]).map((id) => ({ id, name: byId[id] }));
    },
  } as unknown as DepotRepository;
};

describe('GallonNetworkService.outstanding', () => {
  it('merges issue + return rows per depot into outstanding + net deposit', async () => {
    const service = new GallonNetworkService(
      issues([{ depotId: 'd1', gallons: 100, depositHeld: 500000 }]),
      returns([{ depotId: 'd1', gallons: 40, depositRefunded: 200000 }]),
      depots(),
      config,
    );
    const [row] = await service.outstanding();
    expect(row).toEqual({
      depotId: 'd1',
      issued: 100,
      returned: 40,
      outstanding: 60,
      depositHeld: 500000,
      depositRefunded: 200000,
      netDeposit: 300000,
    });
  });

  it('floors outstanding and net deposit at zero when returns exceed issues', async () => {
    const service = new GallonNetworkService(
      issues([{ depotId: 'd1', gallons: 10, depositHeld: 50000 }]),
      returns([{ depotId: 'd1', gallons: 25, depositRefunded: 120000 }]),
      depots(),
      config,
    );
    const [row] = await service.outstanding();
    expect(row.outstanding).toBe(0);
    expect(row.netDeposit).toBe(0);
  });

  it('includes a depot present only in returns (empties handed back, none issued this window)', async () => {
    const service = new GallonNetworkService(
      issues([]),
      returns([{ depotId: 'd2', gallons: 5, depositRefunded: 25000 }]),
      depots(),
      config,
    );
    const [row] = await service.outstanding();
    expect(row).toMatchObject({ depotId: 'd2', issued: 0, returned: 5, outstanding: 0 });
  });

  it('emits one row per depot across both sources', async () => {
    const service = new GallonNetworkService(
      issues([
        { depotId: 'd1', gallons: 30, depositHeld: 0 },
        { depotId: 'd2', gallons: 10, depositHeld: 0 },
      ]),
      returns([{ depotId: 'd3', gallons: 4, depositRefunded: 0 }]),
      depots(),
      config,
    );
    const ids = (await service.outstanding()).map((r) => r.depotId).sort();
    expect(ids).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns an empty array when there is no activity', async () => {
    const service = new GallonNetworkService(issues([]), returns([]), depots(), config);
    expect(await service.outstanding()).toEqual([]);
  });
});

/*
 * J-2: what one depot's customers still owe it, and still have on deposit there — the two
 * columns the depot customer directory used to render as a hardcoded null.
 *
 * Same arithmetic as the network rollup one level up, floored at zero so a return recorded
 * against the wrong depot cannot show as a negative loan.
 */
describe('GallonNetworkService.perCustomer (J-2)', () => {
  const perCustomer = (
    issued: { customerId: string; gallons: number; amountIdr: number }[],
    returned: { customerId: string; gallons: number; amountIdr: number }[],
    dated: { customerId: string; quantity: number; createdAt: Date }[] = [],
  ) =>
    new GallonNetworkService(
      {
        perCustomerForDepot: async () => issued,
        newestIssuesForCustomers: async () => dated,
      } as unknown as GallonIssueRepository,
      { perCustomerForDepot: async () => returned } as unknown as GallonReturnRepository,
      depots(),
      config,
    ).perCustomer('d1');

  it('nets returns off issues, per customer', async () => {
    await expect(
      perCustomer(
        [
          { customerId: 'c1', gallons: 5, amountIdr: 100_000 },
          { customerId: 'c2', gallons: 2, amountIdr: 40_000 },
        ],
        [{ customerId: 'c1', gallons: 2, amountIdr: 40_000 }],
      ),
    ).resolves.toEqual([
      { customerId: 'c1', gallonsOnLoan: 3, depositHeldIdr: 60_000, overdueGallons: 0, oldestIssuedAt: null },
      { customerId: 'c2', gallonsOnLoan: 2, depositHeldIdr: 40_000, overdueGallons: 0, oldestIssuedAt: null },
    ]);
  });

  it('drops a customer who owes nothing and holds no deposit', async () => {
    await expect(
      perCustomer(
        [{ customerId: 'c1', gallons: 3, amountIdr: 60_000 }],
        [{ customerId: 'c1', gallons: 3, amountIdr: 60_000 }],
      ),
    ).resolves.toEqual([]);
  });

  // A return logged against the wrong depot must not read as "the depot owes them gallons".
  it('floors both numbers at zero rather than going negative', async () => {
    await expect(
      perCustomer(
        [{ customerId: 'c1', gallons: 1, amountIdr: 20_000 }],
        [{ customerId: 'c1', gallons: 4, amountIdr: 80_000 }],
      ),
    ).resolves.toEqual([]);
  });

  // A deposit still held with every gallon back is a real row: the money is still there.
  it('keeps a customer who returned the gallons but is owed a refund', async () => {
    await expect(
      perCustomer(
        [{ customerId: 'c1', gallons: 2, amountIdr: 40_000 }],
        [{ customerId: 'c1', gallons: 2, amountIdr: 0 }],
      ),
    ).resolves.toEqual([
      { customerId: 'c1', gallonsOnLoan: 0, depositHeldIdr: 40_000, overdueGallons: 0, oldestIssuedAt: null },
    ]);
  });

  it('is empty for a depot that has issued nothing', async () => {
    await expect(perCustomer([], [])).resolves.toEqual([]);
  });

  /*
   * #26. "2 on loan" hid the difference between a customer who took them last week and one
   * who took them last year. The depot's own limit (14 days here) decides which is which.
   */
  describe('how long the gallons have been out', () => {
    const NOW = new Date('2026-09-28T05:00:00.000Z');
    const ago = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

    beforeEach(() => jest.useFakeTimers({ now: NOW }));
    afterEach(() => jest.useRealTimers());

    it('flags gallons held past the limit and says when the oldest went out', async () => {
      const [row] = await perCustomer(
        [{ customerId: 'c1', gallons: 3, amountIdr: 60_000 }],
        [],
        [
          { customerId: 'c1', quantity: 1, createdAt: ago(3) },
          { customerId: 'c1', quantity: 2, createdAt: ago(40) },
        ],
      );
      expect(row).toMatchObject({
        gallonsOnLoan: 3,
        overdueGallons: 2,
        oldestIssuedAt: ago(40).toISOString(),
      });
    });

    it('does not flag a customer whose gallons are recent', async () => {
      const [row] = await perCustomer(
        [{ customerId: 'c1', gallons: 2, amountIdr: 40_000 }],
        [],
        [{ customerId: 'c1', quantity: 2, createdAt: ago(5) }],
      );
      expect(row).toMatchObject({ overdueGallons: 0, oldestIssuedAt: ago(5).toISOString() });
    });

    // Returns clear the oldest issue first, so a customer who took two long ago, took one
    // yesterday and returned two is holding only yesterday's gallon.
    it('treats returns as settling the oldest issues, not the newest', async () => {
      const [row] = await perCustomer(
        [{ customerId: 'c1', gallons: 3, amountIdr: 60_000 }],
        [{ customerId: 'c1', gallons: 2, amountIdr: 40_000 }],
        [
          { customerId: 'c1', quantity: 1, createdAt: ago(1) },
          { customerId: 'c1', quantity: 2, createdAt: ago(200) },
        ],
      );
      expect(row).toMatchObject({ gallonsOnLoan: 1, overdueGallons: 0 });
    });

    it('ages each customer from their own issues, not from the depot pooled together', async () => {
      const rows = await perCustomer(
        [
          { customerId: 'old', gallons: 1, amountIdr: 20_000 },
          { customerId: 'new', gallons: 1, amountIdr: 20_000 },
        ],
        [],
        [
          { customerId: 'new', quantity: 1, createdAt: ago(1) },
          { customerId: 'old', quantity: 1, createdAt: ago(90) },
        ],
      );
      const by = Object.fromEntries(rows.map((r) => [r.customerId, r.overdueGallons]));
      expect(by).toEqual({ old: 1, new: 0 });
    });

    it('reads dates only for customers who hold gallons, never for a deposit with every gallon back', async () => {
      const newest = jest.fn(async () => []);
      const service = new GallonNetworkService(
        {
          perCustomerForDepot: async () => [
            { customerId: 'holding', gallons: 2, amountIdr: 40_000 },
            { customerId: 'deposit-only', gallons: 2, amountIdr: 40_000 },
          ],
          newestIssuesForCustomers: newest,
        } as unknown as GallonIssueRepository,
        {
          perCustomerForDepot: async () => [{ customerId: 'deposit-only', gallons: 2, amountIdr: 0 }],
        } as unknown as GallonReturnRepository,
        depots(),
        config,
      );
      await service.perCustomer('d1');
      expect(newest).toHaveBeenCalledWith('d1', ['holding'], expect.any(Number));
    });
  });
});

describe('GallonNetworkService.customerLedger', () => {
  const issue = (id: string, at: string, quantity = 1, depositHeld = 20_000) => ({
    id,
    quantity,
    depositHeld,
    createdAt: new Date(at),
  });
  const ret = (id: string, at: string, quantity = 1, depositRefunded = 20_000) => ({
    id,
    quantity,
    depositRefunded,
    createdAt: new Date(at),
  });

  const ledger = (
    issued: ReturnType<typeof issue>[],
    returned: ReturnType<typeof ret>[],
    limit?: number,
  ) =>
    new GallonNetworkService(
      { listForCustomerAtDepot: async () => issued } as unknown as GallonIssueRepository,
      { listForCustomerAtDepot: async () => returned } as unknown as GallonReturnRepository,
      depots(),
      config,
    ).customerLedger('d1', 'c1', limit);

  it('merges both sides into one newest-first history', async () => {
    await expect(
      ledger(
        [issue('i1', '2026-08-01T00:00:00.000Z'), issue('i2', '2026-08-03T00:00:00.000Z')],
        [ret('r1', '2026-08-02T00:00:00.000Z')],
      ),
    ).resolves.toEqual([
      { id: 'i2', type: 'ISSUE', quantity: 1, amountIdr: 20_000, at: '2026-08-03T00:00:00.000Z' },
      { id: 'r1', type: 'RETURN', quantity: 1, amountIdr: 20_000, at: '2026-08-02T00:00:00.000Z' },
      { id: 'i1', type: 'ISSUE', quantity: 1, amountIdr: 20_000, at: '2026-08-01T00:00:00.000Z' },
    ]);
  });

  it('is empty for a customer with no movements at this depot', async () => {
    await expect(ledger([], [])).resolves.toEqual([]);
  });

  // Each side is read at the full limit and only the MERGED list is trimmed — otherwise a
  // customer whose newest movements are all issues would see returns padding the list out.
  it('trims the merged list to the limit', async () => {
    const rows = await ledger(
      [issue('i1', '2026-08-05T00:00:00.000Z'), issue('i2', '2026-08-04T00:00:00.000Z')],
      [ret('r1', '2026-08-01T00:00:00.000Z')],
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(['i1', 'i2']);
  });

  it('clamps a nonsense limit into [1, 100]', async () => {
    await expect(ledger([issue('i1', '2026-08-05T00:00:00.000Z')], [], 0)).resolves.toHaveLength(1);
    await expect(ledger([issue('i1', '2026-08-05T00:00:00.000Z')], [], 9999)).resolves.toHaveLength(
      1,
    );
  });
});

// S2. The daily report asks for one depot's day; the service is a straight pass-through
/*
 * I5: the mirror of perCustomer — one CUSTOMER's balance at each depot they have used.
 * The customer had no screen for either number; both lived only in the staff console.
 */
describe('GallonNetworkService.forCustomer (I5)', () => {
  const forCustomer = (
    issued: { depotId: string; gallons: number; amountIdr: number }[],
    returned: { depotId: string; gallons: number; amountIdr: number }[],
    names: Record<string, string> = { d1: 'Depot Cikini', d2: 'Depot Menteng' },
  ) =>
    new GallonNetworkService(
      { perDepotForCustomer: async () => issued } as unknown as GallonIssueRepository,
      { perDepotForCustomer: async () => returned } as unknown as GallonReturnRepository,
      depots(names),
      config,
    ).forCustomer('c1');

  it('nets each depot and names it, because the customer has no depot directory', async () => {
    await expect(
      forCustomer(
        [
          { depotId: 'd1', gallons: 5, amountIdr: 100000 },
          { depotId: 'd2', gallons: 2, amountIdr: 40000 },
        ],
        [{ depotId: 'd1', gallons: 3, amountIdr: 60000 }],
      ),
    ).resolves.toEqual([
      { depotId: 'd1', depotName: 'Depot Cikini', gallonsOnLoan: 2, depositHeldIdr: 40000 },
      { depotId: 'd2', depotName: 'Depot Menteng', gallonsOnLoan: 2, depositHeldIdr: 40000 },
    ]);
  });

  /*
   * One query for the names, however many depots the customer holds a balance at.
   *
   * This is the assertion the shape needs: the rows come out identical whether the service
   * reads the depots one at a time or all at once, so nothing else in this file could tell
   * the difference — which is why the N+1 survived until it was looked for on purpose.
   */
  it('reads every depot name in one query, not one per row', async () => {
    await forCustomer(
      [
        { depotId: 'd1', gallons: 5, amountIdr: 100000 },
        { depotId: 'd2', gallons: 2, amountIdr: 40000 },
      ],
      [],
    );
    expect(depotCalls.findManyByIds).toBe(1);
    expect(depotCalls.findById).toBe(0);
  });

  // And a customer holding nothing must not produce a query at all — an empty `in` list is
  // a round trip that can only ever return nothing.
  it('asks for no names when the customer owes nothing', async () => {
    await expect(
      forCustomer(
        [{ depotId: 'd1', gallons: 3, amountIdr: 60000 }],
        [{ depotId: 'd1', gallons: 3, amountIdr: 60000 }],
      ),
    ).resolves.toEqual([]);
    expect(depotCalls.findManyByIds).toBe(0);
    expect(depotCalls.findById).toBe(0);
  });

  // Settled up is not the same as "a depot I once used". A list of every depot they ever
  // bought from is not the question being asked.
  it('drops a depot the customer has fully settled with', async () => {
    await expect(
      forCustomer(
        [{ depotId: 'd1', gallons: 3, amountIdr: 60000 }],
        [{ depotId: 'd1', gallons: 3, amountIdr: 60000 }],
      ),
    ).resolves.toEqual([]);
  });

  // Floored for the same reason perCustomer floors: a return recorded against the wrong
  // depot must never show the customer a negative loan — or a negative deposit.
  it('never shows a negative loan or a negative deposit', async () => {
    await expect(
      forCustomer(
        [{ depotId: 'd1', gallons: 1, amountIdr: 20000 }],
        [{ depotId: 'd1', gallons: 4, amountIdr: 80000 }],
      ),
    ).resolves.toEqual([]);
  });

  // A depot row whose depot has since been removed still carries the money. Dropping the
  // row would hide a deposit; an empty name is the honest degradation.
  it('keeps the row when the depot cannot be named', async () => {
    await expect(
      forCustomer([{ depotId: 'gone', gallons: 1, amountIdr: 20000 }], []),
    ).resolves.toEqual([
      { depotId: 'gone', depotName: '', gallonsOnLoan: 1, depositHeldIdr: 20000 },
    ]);
  });
});

// to the repository, and this pins that it does not quietly widen the window.
describe('GallonNetworkService.gallonsInRange', () => {
  it('passes the depot and both bounds through untouched', async () => {
    const gallonsInRange = jest.fn().mockResolvedValue({ gallons: 14, damaged: 3 });
    const service = new GallonNetworkService(
      {} as unknown as GallonIssueRepository,
      { gallonsInRange } as unknown as GallonReturnRepository,
      depots(),
      config,
    );
    const from = new Date('2026-07-14T17:00:00.000Z');
    const to = new Date('2026-07-15T17:00:00.000Z');
    await expect(service.gallonsInRange('d1', from, to)).resolves.toEqual({
      gallons: 14,
      damaged: 3,
    });
    expect(gallonsInRange).toHaveBeenCalledWith('d1', from, to);
  });
});
