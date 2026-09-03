import { PurchaseOrderService } from '../../src/application/services/purchase-order.service';
import { SupplierService } from '../../src/application/services/supplier.service';
import { InventoryService } from '../../src/application/services/inventory.service';
import { ApprovalService } from '../../src/application/services/approval.service';
import { DepotService } from '../../src/application/services/depot.service';
import { InventoryItemType, OwnershipType, StockMovementType } from '../../src/domain/inventory';
import { PoStatus } from '../../src/domain/purchase-order';
import {
  DepotNotFoundError,
  InvalidPurchaseOrderTransitionError,
  PurchaseOrderNotFoundError,
  SupplierNotFoundError,
} from '../../src/domain/errors';
import {
  buildTestConfig,
  FakeLowStockAlert,
  FakeProductCatalog,
  FakeUntrackedSaleAlert,
  InMemoryApprovalRepository,
  InMemoryDepotRepository,
  InMemoryInventoryRepository,
  InMemoryPurchaseOrderRepository,
  InMemorySupplierRepository,
} from '../support/fakes';

const ACTOR = '33333333-3333-3333-3333-333333333333';
const UNKNOWN = '00000000-0000-0000-0000-000000000000';

describe('PurchaseOrderService', () => {
  let depotRepo: InMemoryDepotRepository;
  let inventoryRepo: InMemoryInventoryRepository;
  let poRepo: InMemoryPurchaseOrderRepository;
  let inventory: InventoryService;
  let suppliers: SupplierService;
  let service: PurchaseOrderService;
  let depotId: string;
  let supplierId: string;
  let galonItemId: string;
  let segelItemId: string;

  beforeEach(async () => {
    depotRepo = new InMemoryDepotRepository();
    inventoryRepo = new InMemoryInventoryRepository();
    poRepo = new InMemoryPurchaseOrderRepository();
    const supplierRepo = new InMemorySupplierRepository();
    const config = buildTestConfig();
    const approvals = new ApprovalService(new InMemoryApprovalRepository(), depotRepo, config);
    inventory = new InventoryService(
      inventoryRepo,
      depotRepo,
      new FakeLowStockAlert(),
      new FakeUntrackedSaleAlert(),
      new FakeProductCatalog(),
      approvals,
      config,
    );
    suppliers = new SupplierService(supplierRepo, depotRepo);
    service = new PurchaseOrderService(poRepo, supplierRepo, depotRepo, inventory);

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

    const supplier = await suppliers.create({
      depotId,
      name: 'Tirta Makmur',
      code: 'SUP-01',
      categories: ['Galon 19L', 'Segel'],
    });
    supplierId = supplier.id;

    // Two raw stock lines the PO will receive into.
    const galon = await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.GALON,
        label: 'Galon 19L',
        unit: 'pcs',
        quantity: 10,
        minimumStock: 0,
      },
      ACTOR,
    );
    galonItemId = galon.id;
    const segel = await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.SEGEL,
        label: 'Segel',
        unit: 'pcs',
        quantity: 100,
        minimumStock: 0,
      },
      ACTOR,
    );
    segelItemId = segel.id;
  });

  const draft = () =>
    service.create({
      depotId,
      supplierId,
      shippingIdr: 25_000,
      lines: [
        {
          itemType: InventoryItemType.GALON,
          label: 'Galon 19L',
          quantity: 50,
          unitCostIdr: 18_000,
        },
        { itemType: InventoryItemType.SEGEL, label: 'Segel', quantity: 200, unitCostIdr: 100 },
      ],
    });

  it('creates a DRAFT with computed subtotal + total', async () => {
    const po = await draft();
    expect(po.status).toBe(PoStatus.DRAFT);
    expect(po.poNumber).toMatch(/^PO-/);
    expect(po.subtotalIdr).toBe(50 * 18_000 + 200 * 100); // 920_000
    expect(po.totalIdr).toBe(920_000 + 25_000);
    expect(po.receivedAt).toBeNull();
  });

  it('sends a DRAFT (DRAFT → SENT) and refuses to receive before sending', async () => {
    const po = await draft();
    await expect(service.receive(po.id, ACTOR)).rejects.toBeInstanceOf(
      InvalidPurchaseOrderTransitionError,
    );
    const sent = await service.send(po.id);
    expect(sent.status).toBe(PoStatus.SENT);
    // A second send is rejected — only DRAFT can be sent.
    await expect(service.send(po.id)).rejects.toBeInstanceOf(InvalidPurchaseOrderTransitionError);
  });

  it('receive() emits a RECEIPT movement per line and transitions SENT → RECEIVED', async () => {
    const po = await draft();
    await service.send(po.id);

    const received = await service.receive(po.id, ACTOR);
    expect(received.status).toBe(PoStatus.RECEIVED);
    expect(received.receivedAt).not.toBeNull();

    // One RECEIPT per PO line, added on top of each line's opening balance.
    const galonReceipts = inventoryRepo.moves.filter(
      (m) => m.itemId === galonItemId && m.type === StockMovementType.RECEIPT && m.delta === 50,
    );
    const segelReceipts = inventoryRepo.moves.filter(
      (m) => m.itemId === segelItemId && m.type === StockMovementType.RECEIPT && m.delta === 200,
    );
    expect(galonReceipts).toHaveLength(1);
    expect(segelReceipts).toHaveLength(1);

    // And the depot's on-hand stock rose by the received quantities (10→60, 100→300).
    expect((await inventory.get(galonItemId)).quantity).toBe(60);
    expect((await inventory.get(segelItemId)).quantity).toBe(300);

    // Re-receiving a RECEIVED PO is rejected (no double-post).
    await expect(service.receive(po.id, ACTOR)).rejects.toBeInstanceOf(
      InvalidPurchaseOrderTransitionError,
    );
  });

  it('rejects an unknown PO id', async () => {
    await expect(service.get(UNKNOWN)).rejects.toBeInstanceOf(PurchaseOrderNotFoundError);
  });

  it('defaults shipping to 0 and expectedAt to null when omitted', async () => {
    const po = await service.create({
      depotId,
      supplierId,
      lines: [
        {
          itemType: InventoryItemType.GALON,
          label: 'Galon 19L',
          quantity: 10,
          unitCostIdr: 18_000,
        },
      ],
    });
    expect(po.shippingIdr).toBe(0);
    expect(po.totalIdr).toBe(180_000);
    expect(po.expectedAt).toBeNull();
  });

  it('keeps an explicit expectedAt', async () => {
    const expectedAt = new Date('2026-08-02T00:00:00.000Z');
    const po = await service.create({
      depotId,
      supplierId,
      expectedAt,
      lines: [{ itemType: InventoryItemType.SEGEL, label: 'Segel', quantity: 5, unitCostIdr: 100 }],
    });
    expect(po.expectedAt).toEqual(expectedAt);
  });

  it('rejects creating for an unknown depot, an unknown supplier, or another depot’s supplier', async () => {
    const lines = [
      { itemType: InventoryItemType.GALON, label: 'Galon 19L', quantity: 1, unitCostIdr: 18_000 },
    ];
    await expect(service.create({ depotId: UNKNOWN, supplierId, lines })).rejects.toBeInstanceOf(
      DepotNotFoundError,
    );
    await expect(service.create({ depotId, supplierId: UNKNOWN, lines })).rejects.toBeInstanceOf(
      SupplierNotFoundError,
    );

    const other = await new DepotService(depotRepo).create({
      code: 'JKT-02',
      name: 'Depot Menteng',
      ownershipType: OwnershipType.HKP,
      address: 'b',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.2,
      lng: 106.83,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    const foreign = await suppliers.create({
      depotId: other.id,
      name: 'Tirta Lain',
      code: 'SUP-02',
      categories: [],
    });
    await expect(service.create({ depotId, supplierId: foreign.id, lines })).rejects.toBeInstanceOf(
      SupplierNotFoundError,
    );
  });

  it('lists depot POs, filters by status, and rejects an unknown depot', async () => {
    const po = await draft();
    expect((await service.list(depotId)).map((p) => p.id)).toEqual([po.id]);
    expect(await service.list(depotId, { status: PoStatus.SENT })).toEqual([]);

    await service.send(po.id);
    expect((await service.list(depotId, { status: PoStatus.SENT })).map((p) => p.id)).toEqual([
      po.id,
    ]);
    await expect(service.list(UNKNOWN)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('receives best-effort: a line with no depot stock line is skipped, PO still RECEIVED', async () => {
    const po = await service.create({
      depotId,
      supplierId,
      lines: [
        { itemType: InventoryItemType.TUTUP, label: 'Tutup', quantity: 500, unitCostIdr: 50 },
      ],
    });
    await service.send(po.id);
    const movesBefore = inventoryRepo.moves.length;
    const received = await service.receive(po.id, ACTOR);
    expect(received.status).toBe(PoStatus.RECEIVED);
    expect(inventoryRepo.moves).toHaveLength(movesBefore);
  });

  /*
   * CA-2-64: receiving was all-or-nothing.
   *
   * One button, and it booked in the FULL ordered quantity of every line and stamped the
   * PO RECEIVED. A supplier who sends 40 of 60 galon — the ordinary case — left the depot
   * with two bad answers: press it and put 20 units into the stock ledger that are not in
   * the building, or leave the PO open and book none of the 40 that are. The first is the
   * worse one: that ledger is what the reorder point, the COGS and the next opname read.
   */
  describe('partial receipt (CA-2-64)', () => {
    // PO receipts only — `createLine` posts its opening balance as a RECEIPT too, and
    // counting that as goods-in would make every assertion here off by the opening stock.
    const receiptsFor = (itemId: string) =>
      inventoryRepo.moves
        .filter(
          (m) =>
            m.itemId === itemId &&
            m.type === StockMovementType.RECEIPT &&
            String(m.reason ?? '').startsWith('PO '),
        )
        .map((m) => m.delta);

    async function sent() {
      const po = await draft();
      await service.send(po.id);
      return po.id;
    }

    it('books in only what arrived, and keeps the PO open', async () => {
      const id = await sent();

      const after = await service.receive(id, ACTOR, { 0: 40 });

      expect(receiptsFor(galonItemId)).toEqual([40]);
      expect(receiptsFor(segelItemId)).toEqual([]);
      expect(after.status).toBe(PoStatus.SENT);
      expect(after.receivedAt).toBeNull();
      expect(after.lines.map((l) => l.receivedQuantity ?? 0)).toEqual([40, 0]);
    });

    it('posts the delta on the second delivery, never the line twice', async () => {
      const id = await sent();

      await service.receive(id, ACTOR, { 0: 40 });
      const after = await service.receive(id, ACTOR, { 0: 10, 1: 200 });

      expect(receiptsFor(galonItemId)).toEqual([40, 10]);
      expect(after.status).toBe(PoStatus.RECEIVED);
      expect(after.receivedAt).not.toBeNull();
    });

    it('still receives everything outstanding when no map is given', async () => {
      const id = await sent();

      const after = await service.receive(id, ACTOR);

      expect(receiptsFor(galonItemId)).toEqual([50]);
      expect(after.status).toBe(PoStatus.RECEIVED);
    });

    /*
     * Booking in more than was ordered is not a rounding question — it is either the wrong
     * PO or a supplier sending goods nobody agreed to buy, and the stock ledger must not be
     * where that gets decided silently.
     */
    it('refuses more than the line still has outstanding', async () => {
      const id = await sent();
      await service.receive(id, ACTOR, { 0: 40 });

      await expect(service.receive(id, ACTOR, { 0: 11 })).rejects.toBeInstanceOf(
        InvalidPurchaseOrderTransitionError,
      );
    });

    it('refuses a negative quantity, and a receipt that receives nothing', async () => {
      const id = await sent();

      await expect(service.receive(id, ACTOR, { 0: -1 })).rejects.toBeInstanceOf(
        InvalidPurchaseOrderTransitionError,
      );
      await expect(service.receive(id, ACTOR, { 0: 0, 1: 0 })).rejects.toThrow(
        /Nothing to receive/,
      );
    });
  });
});
