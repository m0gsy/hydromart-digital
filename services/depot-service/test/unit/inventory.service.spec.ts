import { InventoryService } from '../../src/application/services/inventory.service';
import { DepotService } from '../../src/application/services/depot.service';
import { InventoryItemType, OwnershipType, StockMovementType } from '../../src/domain/inventory';
import {
  DepotNotFoundError,
  DuplicateInventoryLineError,
  InsufficientStockError,
  InventoryItemNotFoundError,
  NegativeStockError,
  ProductLineRequiresProductError,
} from '../../src/domain/errors';
import {
  FakeLowStockAlert,
  InMemoryDepotRepository,
  InMemoryInventoryRepository,
} from '../support/fakes';

const ACTOR = 'staff-1';
const TOKEN = 'Bearer staff-token';
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

describe('InventoryService', () => {
  let depotRepo: InMemoryDepotRepository;
  let invRepo: InMemoryInventoryRepository;
  let alerts: FakeLowStockAlert;
  let inventory: InventoryService;
  let depotId: string;

  beforeEach(async () => {
    depotRepo = new InMemoryDepotRepository();
    invRepo = new InMemoryInventoryRepository();
    alerts = new FakeLowStockAlert();
    inventory = new InventoryService(invRepo, depotRepo, alerts);
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
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  const raw = () => ({
    itemType: InventoryItemType.GALON,
    label: 'Galon 19L',
    unit: 'unit',
    quantity: 100,
    minimumStock: 20,
  });

  it('creates a raw stock line with an opening RECEIPT movement', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    expect(item.quantity).toBe(100);
    expect(item.lowStock).toBe(false);
    const moves = await inventory.movements(item.id);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe(StockMovementType.RECEIPT);
    expect(moves[0].quantityAfter).toBe(100);
  });

  it('rejects a stock line for a missing depot', async () => {
    await expect(
      inventory.createLine('22222222-2222-2222-2222-222222222222', raw(), ACTOR),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('rejects a raw line that carries a productId, and a PRODUK line without one', async () => {
    await expect(
      inventory.createLine(depotId, { ...raw(), productId: PRODUCT_ID }, ACTOR),
    ).rejects.toBeInstanceOf(ProductLineRequiresProductError);
    await expect(
      inventory.createLine(depotId, { ...raw(), itemType: InventoryItemType.PRODUK }, ACTOR),
    ).rejects.toBeInstanceOf(ProductLineRequiresProductError);
  });

  it('rejects a duplicate raw line in the same depot', async () => {
    await inventory.createLine(depotId, raw(), ACTOR);
    await expect(inventory.createLine(depotId, raw(), ACTOR)).rejects.toBeInstanceOf(
      DuplicateInventoryLineError,
    );
  });

  it('allows distinct PRODUK lines and blocks duplicates of the same product', async () => {
    const p = { itemType: InventoryItemType.PRODUK, label: 'Air RO', unit: 'unit', quantity: 0, minimumStock: 0 };
    await inventory.createLine(depotId, { ...p, productId: PRODUCT_ID }, ACTOR);
    await expect(
      inventory.createLine(depotId, { ...p, productId: PRODUCT_ID }, ACTOR),
    ).rejects.toBeInstanceOf(DuplicateInventoryLineError);
  });

  it('adjusts stock by a signed delta and records the movement', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    const after = await inventory.adjust(item.id, -30, 'broken', ACTOR);
    expect(after.quantity).toBe(70);
    const moves = await inventory.movements(item.id);
    expect(moves[0].type).toBe(StockMovementType.ADJUSTMENT);
    expect(moves[0].delta).toBe(-30);
  });

  it('refuses an adjustment that would go negative', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    await expect(inventory.adjust(item.id, -200, null, ACTOR)).rejects.toBeInstanceOf(
      NegativeStockError,
    );
  });

  it('reconciles to a physical count via opname, recording variance', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    const after = await inventory.opname(item.id, 95, 'monthly', ACTOR);
    expect(after.quantity).toBe(95);
    const moves = await inventory.movements(item.id);
    expect(moves[0].type).toBe(StockMovementType.OPNAME);
    expect(moves[0].delta).toBe(-5);
  });

  it('flags low stock and lists it', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    await inventory.adjust(item.id, -85, 'sales', ACTOR); // 100 -> 15, below minimum 20
    const low = await inventory.listLowStock(depotId);
    expect(low).toHaveLength(1);
    expect(low[0].lowStock).toBe(true);
  });

  it('404s operating on a missing item', async () => {
    await expect(
      inventory.adjust('33333333-3333-3333-3333-333333333333', 1, null, ACTOR),
    ).rejects.toBeInstanceOf(InventoryItemNotFoundError);
  });

  const produkLine = (productId: string, quantity: number) =>
    inventory.createLine(
      depotId,
      { itemType: InventoryItemType.PRODUK, productId, label: 'Air RO', unit: 'unit', quantity, minimumStock: 0 },
      ACTOR,
    );

  it('consumes sold quantities from PRODUK lines on order completion', async () => {
    const line = await produkLine(PRODUCT_ID, 100);
    const result = await inventory.consumeForOrder(
      depotId,
      'order-1',
      [{ productId: PRODUCT_ID, quantity: 3 }],
      ACTOR,
    );
    expect(result.consumed).toEqual([PRODUCT_ID]);
    expect(result.skipped).toEqual([]);
    expect((await inventory.get(line.id)).quantity).toBe(97);
    const moves = await inventory.movements(line.id);
    expect(moves[0].type).toBe(StockMovementType.SALE);
    expect(moves[0].delta).toBe(-3);
    expect(moves[0].reason).toBe('Order order-1');
  });

  it('skips products the depot does not stock, never erroring', async () => {
    const unstocked = '99999999-9999-9999-9999-999999999999';
    const result = await inventory.consumeForOrder(
      depotId,
      'order-2',
      [{ productId: unstocked, quantity: 1 }],
      ACTOR,
    );
    expect(result.consumed).toEqual([]);
    expect(result.skipped).toEqual([unstocked]);
  });

  it('is idempotent per order — a retried consume does not deduct twice', async () => {
    const line = await produkLine(PRODUCT_ID, 100);
    const items = [{ productId: PRODUCT_ID, quantity: 3 }];
    await inventory.consumeForOrder(depotId, 'order-dup', items, ACTOR);
    const second = await inventory.consumeForOrder(depotId, 'order-dup', items, ACTOR);
    expect(second.consumed).toEqual([PRODUCT_ID]);
    expect((await inventory.get(line.id)).quantity).toBe(97);
    expect(await inventory.movements(line.id)).toHaveLength(2); // opening RECEIPT + 1 SALE
  });

  it('lets a SALE drive stock negative (records reality, not silently dropped)', async () => {
    const line = await produkLine(PRODUCT_ID, 2);
    await inventory.consumeForOrder(depotId, 'order-3', [{ productId: PRODUCT_ID, quantity: 5 }], ACTOR);
    expect((await inventory.get(line.id)).quantity).toBe(-3);
  });

  it('rejects consume for a missing depot', async () => {
    await expect(
      inventory.consumeForOrder(
        '22222222-2222-2222-2222-222222222222',
        'order-4',
        [{ productId: PRODUCT_ID, quantity: 1 }],
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('emits a low-stock alert once when a movement crosses below minimum', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR); // 100, min 20
    await inventory.adjust(item.id, -85, 'sales', ACTOR, TOKEN); // -> 15, crosses low
    expect(alerts.emitted).toHaveLength(1);
    expect(alerts.emitted[0].authorization).toBe(TOKEN);
    expect(alerts.emitted[0].alert).toMatchObject({
      depotName: 'Depot Cikini',
      label: 'Galon 19L',
      quantity: 15,
      minimum: 20,
    });
  });

  it('does not re-alert on further decrements while already low (edge trigger)', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    await inventory.adjust(item.id, -85, null, ACTOR, TOKEN); // 100 -> 15 (alert)
    await inventory.adjust(item.id, -5, null, ACTOR, TOKEN); // 15 -> 10 (still low, no alert)
    expect(alerts.emitted).toHaveLength(1);
  });

  it('does not alert when minimum is 0 (alerting disabled for the line)', async () => {
    await produkLine(PRODUCT_ID, 2); // minimumStock 0
    await inventory.consumeForOrder(depotId, 'order-low', [{ productId: PRODUCT_ID, quantity: 5 }], ACTOR, TOKEN);
    expect(alerts.emitted).toHaveLength(0);
  });

  it('alerts when a SALE crosses a PRODUK line below minimum', async () => {
    await inventory.createLine(
      depotId,
      { itemType: InventoryItemType.PRODUK, productId: PRODUCT_ID, label: 'Air RO', unit: 'unit', quantity: 12, minimumStock: 10 },
      ACTOR,
    );
    await inventory.consumeForOrder(depotId, 'order-x', [{ productId: PRODUCT_ID, quantity: 5 }], ACTOR, TOKEN); // 12 -> 7
    expect(alerts.emitted).toHaveLength(1);
    expect(alerts.emitted[0].alert.quantity).toBe(7);
  });

  const ORDER = '44444444-4444-4444-4444-444444444444';

  it('reserves stock, reducing available without touching physical quantity', async () => {
    const line = await produkLine(PRODUCT_ID, 10);
    const result = await inventory.reserveForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 3 }], ACTOR);
    expect(result.reserved).toEqual([PRODUCT_ID]);
    const view = await inventory.get(line.id);
    expect(view.quantity).toBe(10);
    expect(view.reserved).toBe(3);
    expect(view.available).toBe(7);
  });

  it('rejects a reservation exceeding available stock, holding nothing', async () => {
    const line = await produkLine(PRODUCT_ID, 2);
    await expect(
      inventory.reserveForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 5 }], ACTOR),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await inventory.get(line.id)).reserved).toBe(0);
  });

  it('reserves available lines but rejects the whole order if any line is short (all-or-nothing)', async () => {
    const other = '55555555-5555-5555-5555-555555555555';
    const a = await produkLine(PRODUCT_ID, 10);
    const b = await inventory.createLine(
      depotId,
      { itemType: InventoryItemType.PRODUK, productId: other, label: 'B', unit: 'unit', quantity: 1, minimumStock: 0 },
      ACTOR,
    );
    await expect(
      inventory.reserveForOrder(
        depotId,
        ORDER,
        [
          { productId: PRODUCT_ID, quantity: 3 },
          { productId: other, quantity: 5 },
        ],
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);
    expect((await inventory.get(a.id)).reserved).toBe(0);
    expect((await inventory.get(b.id)).reserved).toBe(0);
  });

  it('skips products the depot does not stock when reserving', async () => {
    const result = await inventory.reserveForOrder(
      depotId,
      ORDER,
      [{ productId: '99999999-9999-9999-9999-999999999999', quantity: 1 }],
      ACTOR,
    );
    expect(result.reserved).toEqual([]);
    expect(result.skipped).toEqual(['99999999-9999-9999-9999-999999999999']);
  });

  it('is idempotent per order — a retried reserve does not double-hold', async () => {
    const line = await produkLine(PRODUCT_ID, 10);
    const items = [{ productId: PRODUCT_ID, quantity: 3 }];
    await inventory.reserveForOrder(depotId, ORDER, items, ACTOR);
    await inventory.reserveForOrder(depotId, ORDER, items, ACTOR);
    expect((await inventory.get(line.id)).reserved).toBe(3);
  });

  it('releases a hold on cancellation, restoring available', async () => {
    const line = await produkLine(PRODUCT_ID, 10);
    const items = [{ productId: PRODUCT_ID, quantity: 4 }];
    await inventory.reserveForOrder(depotId, ORDER, items, ACTOR);
    await inventory.releaseForOrder(depotId, ORDER, items);
    const view = await inventory.get(line.id);
    expect(view.reserved).toBe(0);
    expect(view.available).toBe(10);
  });

  it('converts a hold to a real deduction on completion (quantity and reserved both drop)', async () => {
    const line = await produkLine(PRODUCT_ID, 10);
    const items = [{ productId: PRODUCT_ID, quantity: 4 }];
    await inventory.reserveForOrder(depotId, ORDER, items, ACTOR);
    await inventory.consumeForOrder(depotId, ORDER, items, ACTOR, TOKEN);
    const view = await inventory.get(line.id);
    expect(view.quantity).toBe(6);
    expect(view.reserved).toBe(0);
    expect(view.available).toBe(6);
  });

  it('stores and returns a per-depot price override for a PRODUK line', async () => {
    const line = await inventory.createLine(
      depotId,
      { itemType: InventoryItemType.PRODUK, productId: PRODUCT_ID, label: 'Air RO', unit: 'unit', quantity: 0, minimumStock: 0, sellPrice: 22000 },
      ACTOR,
    );
    expect(line.sellPrice).toBe(22000);
    const prices = await inventory.pricesForProducts(depotId, [PRODUCT_ID]);
    expect(prices).toEqual([{ productId: PRODUCT_ID, sellPrice: 22000 }]);
  });

  it('omits products without an override from the price lookup', async () => {
    await produkLine(PRODUCT_ID, 5); // no sellPrice → catalog base at checkout
    const prices = await inventory.pricesForProducts(depotId, [PRODUCT_ID]);
    expect(prices).toEqual([]);
  });

  it('updates a PRODUK line price override', async () => {
    const line = await produkLine(PRODUCT_ID, 5);
    await inventory.updateMeta(line.id, { sellPrice: 18000 });
    const prices = await inventory.pricesForProducts(depotId, [PRODUCT_ID]);
    expect(prices).toEqual([{ productId: PRODUCT_ID, sellPrice: 18000 }]);
  });
});
