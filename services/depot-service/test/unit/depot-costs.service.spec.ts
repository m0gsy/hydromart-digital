import { DepotCostsService } from '../../src/application/services/depot-costs.service';
import { CashbookRepository } from '../../src/application/ports/cashbook.repository';
import { PurchaseOrderRepository } from '../../src/application/ports/purchase-order.repository';
import { CashDirection, CashbookEntry } from '../../src/domain/cashbook';

const DEPOT = 'depot-1';
const FROM = new Date('2026-06-30T17:00:00.000Z'); // 1 Jul 00:00 WIB
const TO = new Date('2026-07-31T17:00:00.000Z');

const entry = (over: Partial<CashbookEntry>): CashbookEntry =>
  ({
    id: 'c1',
    depotId: DEPOT,
    direction: CashDirection.OUT,
    category: 'SEWA',
    label: 'x',
    amountIdr: 0,
    occurredAt: FROM,
    sourceRef: null,
    actorId: 'a1',
    createdAt: FROM,
    ...over,
  }) as CashbookEntry;

const build = (po: number, entries: CashbookEntry[]) => {
  const purchaseOrders = {
    receivedTotalInRange: jest.fn().mockResolvedValue(po),
  } as unknown as PurchaseOrderRepository;
  const cashbook = {
    listForDepot: jest.fn().mockResolvedValue(entries),
  } as unknown as CashbookRepository;
  return { service: new DepotCostsService(purchaseOrders, cashbook), purchaseOrders, cashbook };
};

describe('DepotCostsService', () => {
  it('reads goods from received POs and operating cost from money that left the till', async () => {
    const { service, purchaseOrders, cashbook } = build(4_000_000, [
      entry({ category: 'SEWA', amountIdr: 1_500_000 }),
      entry({ category: 'LISTRIK', amountIdr: 400_000 }),
      // Cash IN is revenue, not a cost — counting it would subtract the depot's own sales.
      entry({ category: 'COD', direction: CashDirection.IN, amountIdr: 9_000_000 }),
    ]);

    await expect(service.costsInRange(DEPOT, FROM, TO)).resolves.toEqual({
      cogsIdr: 4_000_000,
      opexIdr: 1_900_000,
    });
    expect(purchaseOrders.receivedTotalInRange).toHaveBeenCalledWith(DEPOT, FROM, TO);
    expect(cashbook.listForDepot).toHaveBeenCalledWith(DEPOT, { from: FROM, to: TO });
  });

  /*
   * The whole reason the two figures are separated. A depot that raises a PO in the system
   * AND writes "bayar supplier" in its cash book would be charged for the same water twice —
   * once as goods, once as an expense — and the net profit on the monthly review would be
   * understated by the depot's entire stock bill, every month, invisibly.
   */
  it.each([['PO'], ['po'], ['Pembelian'], [' STOK '], ['purchase']])(
    'keeps a %s cash line out of operating cost, because it is already in goods',
    async (category) => {
      const { service } = build(4_000_000, [
        entry({ category, amountIdr: 4_000_000 }),
        entry({ category: 'SEWA', amountIdr: 1_500_000 }),
      ]);
      const out = await service.costsInRange(DEPOT, FROM, TO);
      expect(out.opexIdr).toBe(1_500_000);
      expect(out.cogsIdr).toBe(4_000_000);
    },
  );

  // Matched on the WHOLE category, not a prefix: a real "PORTAL" or "POS" expense is not
  // stock, and swallowing it would understate cost in the other direction.
  it.each([['PORTAL'], ['POS'], ['POMPA']])(
    'still charges a %s line as operating cost',
    async (category) => {
      const { service } = build(0, [entry({ category, amountIdr: 250_000 })]);
      expect((await service.costsInRange(DEPOT, FROM, TO)).opexIdr).toBe(250_000);
    },
  );

  it('reports zeroes for a window with no POs and no cash out', async () => {
    const { service } = build(0, []);
    await expect(service.costsInRange(DEPOT, FROM, TO)).resolves.toEqual({
      cogsIdr: 0,
      opexIdr: 0,
    });
  });
});
