import { ApprovalService } from '../../src/application/services/approval.service';
import { GallonIssueService } from '../../src/application/services/gallon-issue.service';
import { GallonReturnService } from '../../src/application/services/gallon-return.service';
import { InventoryService } from '../../src/application/services/inventory.service';
import { ApprovalType } from '../../src/domain/approval';
import { GallonCondition } from '../../src/domain/gallon-return';
import { InventoryItemType, OwnershipType } from '../../src/domain/inventory';
import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  FakeLowStockAlert,
  FakeProductCatalog,
  FakeUntrackedSaleAlert,
  InMemoryApprovalRepository,
  InMemoryDepotRepository,
  InMemoryGallonIssueRepository,
  InMemoryInventoryRepository,
  buildTestConfig,
} from '../support/fakes';

/**
 * CA-2-57 — two gallon ledgers that never touched the gallons.
 *
 * `gallon_issues` recorded every empty handed out on deposit and `gallon_returns` every one
 * handed back, and neither ever moved the depot's GALON inventory line. So "galon beredar"
 * (a deposit ledger, in rupiah and count) and "galon di depot" (a physical count) were two
 * books about the same bottles that could not disagree out loud. The physical one only ever
 * moved when somebody typed into it, which means the drift was invisible until an opname —
 * and an opname reports a variance without being able to say where it came from.
 *
 * A refill exchange is the case that shows why the pair has to move together: one empty out
 * and one empty in nets to zero, and both halves have to be booked for that to be true.
 */

const GALLON_DEPOSIT_IDR = 20_000;
// A real config, not a one-getter stub: the shortfall path runs through ApprovalService,
// which reads the auto-pass threshold. `0` means every variance needs a human, so the test
// measures the queue rather than a threshold that happened to swallow it.
const configStub: DepotConfigService = buildTestConfig({ APPROVAL_AUTO_PASS_IDR: '0' });

const DEPOT = {
  code: 'JKT-01',
  name: 'Depot Cikini',
  ownershipType: OwnershipType.HKP,
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat: -6.19,
  lng: 106.84,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: null,
  operatingHours: {},
  holidays: [],
};

const ORDER = '00000000-0000-4000-8000-000000000001';

interface Ctx {
  depotId: string;
  issue: GallonIssueService;
  ret: GallonReturnService;
  invRepo: InMemoryInventoryRepository;
  approvalRepo: InMemoryApprovalRepository;
  gallonQty: () => Promise<number>;
}

/** `startingGallons: null` = the depot has no GALON line at all. */
async function build(startingGallons: number | null): Promise<Ctx> {
  const depots = new InMemoryDepotRepository();
  const invRepo = new InMemoryInventoryRepository();
  const approvalRepo = new InMemoryApprovalRepository();
  const approvals = new ApprovalService(approvalRepo, depots, configStub);
  const inventory = new InventoryService(
    invRepo,
    depots,
    new FakeLowStockAlert(),
    new FakeUntrackedSaleAlert(),
    new FakeProductCatalog(),
    approvals,
    configStub,
  );
  const depotId = (await depots.create(DEPOT)).id;
  if (startingGallons !== null) {
    await invRepo.create({
      depotId,
      itemType: InventoryItemType.GALON,
      productId: null,
      label: 'Galon kosong',
      unit: 'galon',
      quantity: startingGallons,
      minimumStock: 0,
      sellPrice: null,
    });
  }
  const issues = new InMemoryGallonIssueRepository();
  return {
    depotId,
    invRepo,
    approvalRepo,
    issue: new GallonIssueService(issues, depots, configStub, inventory, approvals),
    ret: new GallonReturnService(
      // The return repository only has to answer `create`/`createFromOrder` here — the
      // stock movement is what this file measures, not the ledger's own paging.
      new (class {
        private seq = 0;
        rows: { id: string; orderId: string | null; quantity: number }[] = [];
        create = async (data: Record<string, unknown>): Promise<unknown> => {
          const row = { id: `r${++this.seq}`, createdAt: new Date(), ...data } as never;
          this.rows.push(row);
          return row;
        };
        createFromOrder = async (
          data: Record<string, unknown>,
        ): Promise<{ record: unknown; created: boolean }> => {
          const existing = this.rows.find((r) => r.orderId === data.orderId);
          if (existing) return { record: existing, created: false };
          return { record: await this.create(data), created: true };
        };
        // `measureAgainstOutstanding` reads both books before it writes; these answer it.
        private totals = (rows: { quantity: number }[]) => ({
          gallons: rows.reduce((n, r) => n + r.quantity, 0),
        });
        summaryForCustomerAtDepot = async (): Promise<unknown> => ({
          ...this.totals(this.rows),
          amountIdr: 0,
        });
        summaryForDepot = async (): Promise<unknown> => ({
          ...this.totals(this.rows),
          returns: this.rows.length,
          depositRefunded: 0,
        });
      })() as never,
      issues as never,
      depots,
      configStub,
      approvals,
      inventory,
    ),
    gallonQty: async () =>
      (await invRepo.findLine(depotId, InventoryItemType.GALON, null))?.quantity ?? -1,
  };
}

describe('CA-2-57 the gallon ledgers move the gallons', () => {
  it('takes empties off the shelf when they go out on deposit', async () => {
    const c = await build(10);
    await c.issue.record(c.depotId, { customerId: 'ani', quantity: 3 }, 'staff-1');
    expect(await c.gallonQty()).toBe(7);
  });

  it('puts them back when they come back in good condition', async () => {
    const c = await build(10);
    await c.issue.record(c.depotId, { customerId: 'ani', quantity: 3 }, 'staff-1');
    // The middle step is asserted on purpose. "Ends at 10" alone is true of a depot whose
    // count never moved at all, so a net-zero assertion cannot fail if BOTH halves are
    // missing — which is precisely the state this row is about.
    expect(await c.gallonQty()).toBe(7);

    await c.ret.record(c.depotId, { customerId: 'ani', quantity: 3 }, 'staff-1');
    // A refill exchange nets to zero — true only when both halves are booked.
    expect(await c.gallonQty()).toBe(10);
  });

  it('leaves a damaged empty out of the count, and says so through an approval', async () => {
    const c = await build(10);
    await c.issue.record(c.depotId, { customerId: 'ani', quantity: 2 }, 'staff-1');
    await c.ret.record(
      c.depotId,
      { customerId: 'ani', quantity: 2, condition: GallonCondition.DAMAGED },
      'staff-1',
    );
    // The GALON line counts bottles that can go back into service. A broken one is on the
    // premises and is not one of those; its fate is the manager's, and it already has a row.
    expect(await c.gallonQty()).toBe(8);
    expect(c.approvalRepo.rows.some((r) => r.type === ApprovalType.DEPOSIT_REFUND)).toBe(true);
  });

  it('books what the shelf had and queues the rest rather than refusing the issue', async () => {
    const c = await build(2);
    await c.issue.record(c.depotId, { customerId: 'ani', quantity: 5 }, 'staff-1');

    // The gallons left the building. Refusing the movement because the count was already
    // wrong would lose the only record that says they did.
    expect(await c.gallonQty()).toBe(0);
    const variance = c.approvalRepo.rows.find((r) => r.type === ApprovalType.GALLON_VARIANCE);
    expect(variance).toBeTruthy();
    expect(variance?.amountIdr).toBe(3 * GALLON_DEPOSIT_IDR);
  });

  it('still books the ledger when the depot has no gallon line at all', async () => {
    const c = await build(null);
    // A setup fault, not a reason to lose the issue: the ledger row is the fact.
    await expect(
      c.issue.record(c.depotId, { customerId: 'ani', quantity: 3 }, 'staff-1'),
    ).resolves.toMatchObject({ quantity: 3 });
  });

  it('does not deduct twice when the completion fan-out replays', async () => {
    const c = await build(10);
    await c.issue.recordFromOrder(c.depotId, { orderId: ORDER, customerId: 'ani', quantity: 2 }, 'sys');
    await c.issue.recordFromOrder(c.depotId, { orderId: ORDER, customerId: 'ani', quantity: 2 }, 'sys');
    // At-least-once delivery. The order id is the idempotency key on the movement too.
    expect(await c.gallonQty()).toBe(8);
  });
});
