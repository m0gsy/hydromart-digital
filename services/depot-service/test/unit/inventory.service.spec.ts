import { InventoryService } from '../../src/application/services/inventory.service';
import { DepotService } from '../../src/application/services/depot.service';
import { InventoryItemType, OwnershipType, StockMovementType } from '../../src/domain/inventory';
import {
  DepotNotFoundError,
  DuplicateInventoryLineError,
  InventoryItemNotFoundError,
  NegativeStockError,
  ProductLineRequiresProductError,
} from '../../src/domain/errors';
import { InMemoryDepotRepository, InMemoryInventoryRepository } from '../support/fakes';

const ACTOR = 'staff-1';
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

describe('InventoryService', () => {
  let depotRepo: InMemoryDepotRepository;
  let invRepo: InMemoryInventoryRepository;
  let inventory: InventoryService;
  let depotId: string;

  beforeEach(async () => {
    depotRepo = new InMemoryDepotRepository();
    invRepo = new InMemoryInventoryRepository();
    inventory = new InventoryService(invRepo, depotRepo);
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
});
