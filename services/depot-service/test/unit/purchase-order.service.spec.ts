import { PurchaseOrderService } from '../../src/application/services/purchase-order.service';
import { SupplierService } from '../../src/application/services/supplier.service';
import { InventoryService } from '../../src/application/services/inventory.service';
import { ApprovalService } from '../../src/application/services/approval.service';
import { DepotService } from '../../src/application/services/depot.service';
import { InventoryItemType, OwnershipType, StockMovementType } from '../../src/domain/inventory';
import { PoStatus } from '../../src/domain/purchase-order';
import {
  InvalidPurchaseOrderTransitionError,
  PurchaseOrderNotFoundError,
} from '../../src/domain/errors';
import {
  buildTestConfig,
  FakeLowStockAlert,
  InMemoryApprovalRepository,
  InMemoryDepotRepository,
  InMemoryInventoryRepository,
  InMemoryPurchaseOrderRepository,
  InMemorySupplierRepository,
} from '../support/fakes';

const ACTOR = '33333333-3333-3333-3333-333333333333';

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
      { itemType: InventoryItemType.GALON, label: 'Galon 19L', unit: 'pcs', quantity: 10, minimumStock: 0 },
      ACTOR,
    );
    galonItemId = galon.id;
    const segel = await inventory.createLine(
      depotId,
      { itemType: InventoryItemType.SEGEL, label: 'Segel', unit: 'pcs', quantity: 100, minimumStock: 0 },
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
        { itemType: InventoryItemType.GALON, label: 'Galon 19L', quantity: 50, unitCostIdr: 18_000 },
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
    await expect(service.get('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      PurchaseOrderNotFoundError,
    );
  });
});
