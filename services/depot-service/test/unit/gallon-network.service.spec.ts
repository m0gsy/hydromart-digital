import { GallonNetworkService } from '../../src/application/services/gallon-network.service';
import {
  GallonIssueDepotRow,
  GallonIssueRepository,
} from '../../src/application/ports/gallon-issue.repository';
import {
  GallonReturnDepotRow,
  GallonReturnRepository,
} from '../../src/application/ports/gallon-return.repository';

// Only networkSummary() is exercised; the rest of each repo port is irrelevant to the
// rollup, so the fakes stub just that one method.
const issues = (rows: GallonIssueDepotRow[]) =>
  ({ networkSummary: async () => rows }) as unknown as GallonIssueRepository;
const returns = (rows: GallonReturnDepotRow[]) =>
  ({ networkSummary: async () => rows }) as unknown as GallonReturnRepository;

describe('GallonNetworkService.outstanding', () => {
  it('merges issue + return rows per depot into outstanding + net deposit', async () => {
    const service = new GallonNetworkService(
      issues([{ depotId: 'd1', gallons: 100, depositHeld: 500000 }]),
      returns([{ depotId: 'd1', gallons: 40, depositRefunded: 200000 }]),
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
    );
    const [row] = await service.outstanding();
    expect(row.outstanding).toBe(0);
    expect(row.netDeposit).toBe(0);
  });

  it('includes a depot present only in returns (empties handed back, none issued this window)', async () => {
    const service = new GallonNetworkService(
      issues([]),
      returns([{ depotId: 'd2', gallons: 5, depositRefunded: 25000 }]),
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
    );
    const ids = (await service.outstanding()).map((r) => r.depotId).sort();
    expect(ids).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns an empty array when there is no activity', async () => {
    const service = new GallonNetworkService(issues([]), returns([]));
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
  ) =>
    new GallonNetworkService(
      { perCustomerForDepot: async () => issued } as unknown as GallonIssueRepository,
      { perCustomerForDepot: async () => returned } as unknown as GallonReturnRepository,
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
      { customerId: 'c1', gallonsOnLoan: 3, depositHeldIdr: 60_000 },
      { customerId: 'c2', gallonsOnLoan: 2, depositHeldIdr: 40_000 },
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
    ).resolves.toEqual([{ customerId: 'c1', gallonsOnLoan: 0, depositHeldIdr: 40_000 }]);
  });

  it('is empty for a depot that has issued nothing', async () => {
    await expect(perCustomer([], [])).resolves.toEqual([]);
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
      [
        issue('i1', '2026-08-05T00:00:00.000Z'),
        issue('i2', '2026-08-04T00:00:00.000Z'),
      ],
      [ret('r1', '2026-08-01T00:00:00.000Z')],
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(['i1', 'i2']);
  });

  it('clamps a nonsense limit into [1, 100]', async () => {
    await expect(ledger([issue('i1', '2026-08-05T00:00:00.000Z')], [], 0)).resolves.toHaveLength(1);
    await expect(
      ledger([issue('i1', '2026-08-05T00:00:00.000Z')], [], 9999),
    ).resolves.toHaveLength(1);
  });
});
