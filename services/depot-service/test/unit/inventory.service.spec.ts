import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { InventoryService } from '../../src/application/services/inventory.service';
import { DepotService } from '../../src/application/services/depot.service';
import { InventoryItemType, OwnershipType, StockMovementType } from '../../src/domain/inventory';
import {
  CatalogProductNotFoundError,
  DepotNotFoundError,
  DuplicateInventoryLineError,
  InsufficientStockError,
  InventoryItemNotFoundError,
  InventoryLineHasSalesError,
  InventoryLineNotEmptyError,
  NegativeStockError,
  ProductLineRequiresProductError,
} from '../../src/domain/errors';
import {
  buildTestConfig,
  FakeLowStockAlert,
  FakeProductCatalog,
  FakeUntrackedSaleAlert,
  InMemoryApprovalRepository,
  InMemoryDepotRepository,
  InMemoryInventoryRepository,
} from '../support/fakes';
import { ApprovalService } from '../../src/application/services/approval.service';

const ACTOR = 'staff-1';
const TOKEN = 'Bearer staff-token';
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

describe('InventoryService', () => {
  let depotRepo: InMemoryDepotRepository;
  let invRepo: InMemoryInventoryRepository;
  let alerts: FakeLowStockAlert;
  let untracked: FakeUntrackedSaleAlert;
  let catalog: FakeProductCatalog;
  let inventory: InventoryService;
  let depotId: string;

  beforeEach(async () => {
    depotRepo = new InMemoryDepotRepository();
    invRepo = new InMemoryInventoryRepository();
    alerts = new FakeLowStockAlert();
    const config = buildTestConfig();
    const approvals = new ApprovalService(new InMemoryApprovalRepository(), depotRepo, config);
    untracked = new FakeUntrackedSaleAlert();
    catalog = new FakeProductCatalog();
    inventory = new InventoryService(
      invRepo,
      depotRepo,
      alerts,
      untracked,
      catalog,
      approvals,
      config,
    );
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
    // The catalog knows the product these tests open PRODUK lines for. A line for a
    // product the catalog has never heard of is refused — that case is tested on its own.
    catalog.products.set(PRODUCT_ID, {
      id: PRODUCT_ID,
      name: 'Air Galon 19L',
      sku: 'AIR-19L',
      unit: 'Galon',
      active: true,
    });
  });

  const raw = () => ({
    itemType: InventoryItemType.GALON,
    label: 'Galon 19L',
    unit: 'unit',
    quantity: 100,
    minimumStock: 20,
  });

  // Every depot-scoped read and write checks the depot exists first: without it a typo'd id
  // silently reads an empty depot instead of failing, and a reservation could be booked
  // against nothing at all.
  describe('an unknown depot is refused, not treated as empty', () => {
    const UNKNOWN = '99999999-9999-4999-8999-999999999999';

    it('on every entry point that takes a depot id', async () => {
      await expect(inventory.listForDepot(UNKNOWN, {})).rejects.toBeInstanceOf(DepotNotFoundError);
      await expect(
        inventory.reserveForOrder(
          UNKNOWN,
          'ord-1',
          [{ productId: PRODUCT_ID, quantity: 1 }],
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(DepotNotFoundError);
      await expect(
        inventory.releaseForOrder(UNKNOWN, 'ord-1', [{ productId: PRODUCT_ID, quantity: 1 }]),
      ).rejects.toBeInstanceOf(DepotNotFoundError);
      await expect(
        inventory.listMovementsForDepot(UNKNOWN, { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(DepotNotFoundError);
    });
  });

  describe('lines that cannot move', () => {
    it('skips a non-positive quantity and a product this depot does not stock', async () => {
      const reserved = await inventory.reserveForOrder(
        depotId,
        'ord-1',
        [
          { productId: PRODUCT_ID, quantity: 0 },
          { productId: '22222222-2222-4222-8222-222222222222', quantity: 2 },
        ],
        ACTOR,
      );

      expect(reserved.reserved).toEqual([]);
      expect(reserved.skipped).toContain('22222222-2222-4222-8222-222222222222');
    });

    it('skips a non-positive quantity on consume too', async () => {
      const out = await inventory.consumeForOrder(
        depotId,
        'ord-1',
        [{ productId: PRODUCT_ID, quantity: 0 }],
        ACTOR,
      );
      expect(out).toMatchObject({ consumed: [], skipped: [] });
    });

    it('reports a shortfall on an item the plan no longer knows by product', async () => {
      await inventory.createLine(
        depotId,
        { ...raw(), itemType: InventoryItemType.PRODUK, productId: PRODUCT_ID, quantity: 1 },
        ACTOR,
      );
      jest
        .spyOn(invRepo, 'reserveAtomic')
        .mockResolvedValue({ shortfalls: [{ itemId: 'ghost', requested: 5, available: 0 }] });
      await expect(
        inventory.reserveForOrder(
          depotId,
          'ord-9',
          [{ productId: PRODUCT_ID, quantity: 5 }],
          ACTOR,
        ),
      ).rejects.toThrow(/ghost \(need 5, have 0\)/);
    });

    // Audit S-3 and its Q-17 baseline row. Fulfilment used to ask for the depot's line and
    // the retry check one product at a time — five round-trips per cart line before a
    // single write. The number that matters is that neither read grows with the order.
    it('reads lines and prior movements once for the whole order', async () => {
      const productIds = [
        PRODUCT_ID,
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
      ];
      for (const id of productIds) {
        catalog.products.set(id, {
          id,
          name: 'Air Galon 19L',
          sku: `SKU-${id.slice(0, 4)}`,
          unit: 'Galon',
          active: true,
        });
        await inventory.createLine(
          depotId,
          { ...raw(), itemType: InventoryItemType.PRODUK, productId: id },
          ACTOR,
        );
      }
      invRepo.findLinesCalls = 0;
      invRepo.movementLookupCalls = 0;

      const out = await inventory.consumeForOrder(
        depotId,
        'ord-batch',
        productIds.map((productId) => ({ productId, quantity: 1 })),
        ACTOR,
      );

      expect(out.consumed).toHaveLength(3);
      expect(invRepo.findLinesCalls).toBe(1);
      expect(invRepo.movementLookupCalls).toBe(1);
    });

    it('releasing a product with no line here is a no-op, not an error', async () => {
      const released = await inventory.releaseForOrder(depotId, 'ord-1', [
        { productId: '22222222-2222-4222-8222-222222222222', quantity: 1 },
      ]);

      expect(released.released).toEqual([]);
    });
  });

  it('imports many stock lines, skipping the ones already on the shelf', async () => {
    await inventory.createLine(depotId, raw(), ACTOR);

    const summary = await inventory.importLines(
      depotId,
      [
        raw(), // duplicate of the line above
        { ...raw(), itemType: InventoryItemType.TUTUP, label: 'Tutup galon', quantity: 500 },
        { ...raw(), itemType: InventoryItemType.PRODUK, label: 'Salah', quantity: 1 }, // needs productId
      ],
      ACTOR,
    );

    expect(summary).toMatchObject({ created: 1, skipped: 1, failed: 1 });
    expect(summary.results.map((r) => [r.row, r.status])).toEqual([
      [1, 'skipped'],
      [2, 'created'],
      [3, 'failed'],
    ]);
    const lines = await inventory.listForDepot(depotId, {});
    expect(lines).toHaveLength(2);
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
    const p = {
      itemType: InventoryItemType.PRODUK,
      label: 'Air RO',
      unit: 'unit',
      quantity: 0,
      minimumStock: 0,
    };
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

  // CA-2-21. Two staff correcting the same line at the same time both read 100; the write
  // used to be the finished number, so whichever saved second wrote 100-30 or 100-10 over
  // the other and one correction vanished from the shelf count while both stayed in the
  // ledger. Interleaved here on purpose: they start together and land together.
  it('keeps both of two adjustments that start from the same read', async () => {
    const item = await inventory.createLine(depotId, raw(), ACTOR);
    await Promise.all([
      inventory.adjust(item.id, -30, 'pecah', ACTOR),
      inventory.adjust(item.id, -10, 'bocor', ACTOR),
    ]);
    expect((await inventory.get(item.id)).quantity).toBe(60);
    const moves = await inventory.movements(item.id);
    // And the ledger tells the same story the shelf does: 100 -> 70 -> 60, no overlap.
    const adjustments = moves.filter((m) => m.type === StockMovementType.ADJUSTMENT);
    expect(adjustments.map((m) => m.quantityAfter).sort((a, b) => a - b)).toEqual([60, 70]);
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
      {
        itemType: InventoryItemType.PRODUK,
        productId,
        label: 'Air RO',
        unit: 'unit',
        quantity,
        minimumStock: 0,
      },
      ACTOR,
    );

  // A PRODUK line points at a catalog product by id. Nothing used to check that the id
  // led anywhere, so a hand-typed UUID produced a line no order would ever match, and a
  // hand-typed label drifted from the catalog the moment anyone renamed the product.
  describe('a PRODUK line is validated and named by the catalog', () => {
    it('refuses a product the catalog does not have', async () => {
      const ghost = '77777777-7777-4777-8777-777777777777';
      await expect(produkLine(ghost, 5)).rejects.toBeInstanceOf(CatalogProductNotFoundError);
      expect(await invRepo.listForDepot(depotId, {})).toHaveLength(0);
    });

    it('takes the catalog name and unit over whatever was typed', async () => {
      const line = await produkLine(PRODUCT_ID, 5);
      expect(line.label).toBe('Air Galon 19L'); // typed 'Air RO'
      expect(line.unit).toBe('Galon'); // typed 'unit'
    });

    // Fail open: product-service being down must not stop a depot from registering stock.
    it('accepts the typed label when the catalog is unreachable', async () => {
      catalog.unavailable = true;
      const line = await produkLine(PRODUCT_ID, 5);
      expect(line.label).toBe('Air RO');
      expect(line.unit).toBe('unit');
    });

    // An import file identifies a product by the code printed on the shelf. Requiring a
    // UUID was why the CSV wizard was, in practice, unusable.
    it('resolves a row that carries a sku instead of an id', async () => {
      const line = await inventory.createLine(
        depotId,
        {
          itemType: InventoryItemType.PRODUK,
          sku: 'AIR-19L',
          label: 'apa saja',
          unit: 'x',
          quantity: 7,
          minimumStock: 0,
        },
        ACTOR,
      );
      expect(line.productId).toBe(PRODUCT_ID);
      expect(line.label).toBe('Air Galon 19L');
      expect(line.quantity).toBe(7);
    });

    it('refuses a sku the catalog does not have', async () => {
      await expect(
        inventory.createLine(
          depotId,
          {
            itemType: InventoryItemType.PRODUK,
            sku: 'TIDAK-ADA',
            label: 'x',
            unit: 'x',
            quantity: 0,
            minimumStock: 0,
          },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(CatalogProductNotFoundError);
    });

    // With only a SKU there is no id to fall back to, so this one cannot fail open.
    it('refuses a sku row when the catalog is unreachable', async () => {
      catalog.unavailable = true;
      await expect(
        inventory.createLine(
          depotId,
          {
            itemType: InventoryItemType.PRODUK,
            sku: 'AIR-19L',
            label: 'x',
            unit: 'x',
            quantity: 0,
            minimumStock: 0,
          },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(CatalogProductNotFoundError);
    });

    it('never asks the catalog about a raw stock line', async () => {
      catalog.unavailable = true; // would fail the lookup if one were made
      const line = await inventory.createLine(depotId, raw(), ACTOR);
      expect(line.label).toBe('Galon 19L');
    });
  });

  // A mis-created line used to be permanent: nothing in any console could remove it.
  describe('deleting a stock line', () => {
    it('removes a line that never held stock or sold anything', async () => {
      const line = await inventory.createLine(
        depotId,
        { ...raw(), quantity: 0 },
        ACTOR,
      );
      await inventory.deleteLine(line.id);
      expect(await inventory.listForDepot(depotId, {})).toHaveLength(0);
    });

    // Deleting a line with stock on it would make the discrepancy disappear rather than
    // explain it. Count it to zero first — that leaves an OPNAME movement saying so.
    it('refuses while stock is still on the line', async () => {
      const line = await inventory.createLine(depotId, raw(), ACTOR);
      await expect(inventory.deleteLine(line.id)).rejects.toBeInstanceOf(InventoryLineNotEmptyError);
    });

    it('refuses while an order still holds units', async () => {
      const line = await produkLine(PRODUCT_ID, 5);
      await inventory.reserveForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 5 }], ACTOR);
      await inventory.adjust(line.id, -0, null, ACTOR).catch(() => undefined);
      await expect(inventory.deleteLine(line.id)).rejects.toBeInstanceOf(InventoryLineNotEmptyError);
    });

    // Movements cascade on delete, so a line that ever sold would take the depot's sales
    // record with it. Those are hidden by deactivating the product, never deleted.
    it('refuses a line that has recorded sales, even when it is empty now', async () => {
      const line = await produkLine(PRODUCT_ID, 2);
      await inventory.consumeForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 2 }], ACTOR);
      expect((await inventory.get(line.id)).quantity).toBe(0);
      await expect(inventory.deleteLine(line.id)).rejects.toBeInstanceOf(InventoryLineHasSalesError);
    });

    it('refuses an item id that does not exist', async () => {
      await expect(
        inventory.deleteLine('99999999-9999-4999-8999-999999999999'),
      ).rejects.toBeInstanceOf(InventoryItemNotFoundError);
    });
  });

  // "Dipesan" was a bare number with nothing behind it: an operator seeing 0 available on a
  // full shelf had no way to find which orders were holding it.
  describe('reservation drill-down', () => {
    it('lists the active holds on a line', async () => {
      await produkLine(PRODUCT_ID, 10);
      await inventory.reserveForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 3 }], ACTOR);
      const [item] = await inventory.listForDepot(depotId, {});
      const holds = await inventory.listReservations(item.id);
      expect(holds).toHaveLength(1);
      expect(holds[0]).toMatchObject({ orderId: ORDER, quantity: 3 });
    });

    it('refuses an item id that does not exist', async () => {
      await expect(
        inventory.listReservations('99999999-9999-4999-8999-999999999999'),
      ).rejects.toBeInstanceOf(InventoryItemNotFoundError);
    });
  });

  // A line copies the product's name when it is opened, so the catalog has to push its
  // edits here or every depot keeps showing a name the catalog stopped using.
  describe('a catalog change reaches the lines that copied it', () => {
    it('renames the line in every depot at once', async () => {
      const second = await new DepotService(depotRepo).create({
        code: 'JKT-02',
        name: 'Depot Menteng',
        ownershipType: OwnershipType.HKP,
        address: 'b',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        lat: -6.2,
        lng: 106.8,
        serviceRadiusKm: 5,
        deliveryFee: 5000,
        minOrderAmount: null,
        ownerId: null,
        operatingHours: {},
        holidays: [],
      });
      await produkLine(PRODUCT_ID, 10);
      await inventory.createLine(
        second.id,
        { itemType: InventoryItemType.PRODUK, productId: PRODUCT_ID, label: 'x', unit: 'x', quantity: 1, minimumStock: 0 },
        ACTOR,
      );

      const result = await inventory.applyProductChange({
        productId: PRODUCT_ID,
        name: 'Air Galon 19,2L',
        unit: 'Galon',
        active: true,
      });

      expect(result.renamed).toBe(2);
      const labels = [
        ...(await inventory.listForDepot(depotId, {})),
        ...(await inventory.listForDepot(second.id, {})),
      ].map((i) => i.label);
      expect(labels).toEqual(['Air Galon 19,2L', 'Air Galon 19,2L']);
    });

    // Hidden, not deleted: the movement ledger is the depot's record of what it sold, and
    // an order placed before the product was switched off still has to settle.
    it('hides the line from the operator but keeps it settleable', async () => {
      const line = await produkLine(PRODUCT_ID, 10);
      await inventory.reserveForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 2 }], ACTOR);

      await inventory.applyProductChange({
        productId: PRODUCT_ID,
        name: 'Air Galon 19L',
        unit: 'Galon',
        active: false,
      });

      expect(await inventory.listForDepot(depotId, {})).toHaveLength(0);
      const settled = await inventory.consumeForOrder(
        depotId,
        ORDER,
        [{ productId: PRODUCT_ID, quantity: 2 }],
        ACTOR,
      );
      expect(settled.consumed).toEqual([PRODUCT_ID]);
      expect((await inventory.get(line.id)).quantity).toBe(8);
    });

    it('brings the line back when the product is switched on again', async () => {
      await produkLine(PRODUCT_ID, 10);
      const change = { productId: PRODUCT_ID, name: 'Air Galon 19L', unit: 'Galon' };
      await inventory.applyProductChange({ ...change, active: false });
      await inventory.applyProductChange({ ...change, active: true });
      expect(await inventory.listForDepot(depotId, {})).toHaveLength(1);
    });

    // product-service pushes every change and cannot know which products a depot stocks.
    it('is a no-op for a product no depot stocks', async () => {
      await expect(
        inventory.applyProductChange({
          productId: '99999999-9999-4999-8999-999999999999',
          name: 'x',
          unit: 'x',
          active: true,
        }),
      ).resolves.toEqual({ renamed: 0, hidden: 0 });
    });
  });

  // Decision: a product with no stock line still sells — refusing a customer's order over
  // missing paperwork is worse than an untracked deduction. But it must never be silent.
  describe('an untracked sale warns the depot', () => {
    const UNSTOCKED = '88888888-8888-4888-8888-888888888888';

    it('emits one alert naming every product that had no line', async () => {
      await produkLine(PRODUCT_ID, 100);
      const result = await inventory.consumeForOrder(
        depotId,
        ORDER,
        [
          { productId: PRODUCT_ID, quantity: 2 },
          { productId: UNSTOCKED, quantity: 3 },
        ],
        ACTOR,
      );
      expect(result.consumed).toEqual([PRODUCT_ID]);
      expect(result.skipped).toEqual([UNSTOCKED]);
      expect(untracked.emitted).toHaveLength(1);
      expect(untracked.emitted[0]).toMatchObject({
        depotId,
        orderId: ORDER,
        productIds: [UNSTOCKED],
        stage: 'COMPLETION',
      });
    });

    /*
     * K2.6 — the warning arrives when the sale is PROMISED, not hours later.
     *
     * `reserveForOrder` already knew: it pushes a product with no stock line onto `skipped`
     * and lets the checkout through, which is right — a customer's order must not fail
     * because paperwork is missing. What was wrong is that the only alert fired from
     * `consumeForOrder`, at completion, with the goods already gone and nothing left for
     * the operator to decide.
     */
    it('warns at checkout, when the sale is promised and still fixable', async () => {
      await produkLine(PRODUCT_ID, 100);
      const result = await inventory.reserveForOrder(
        depotId,
        ORDER,
        [
          { productId: PRODUCT_ID, quantity: 2 },
          { productId: UNSTOCKED, quantity: 3 },
        ],
        ACTOR,
      );
      expect(result.reserved).toEqual([PRODUCT_ID]);
      expect(result.skipped).toEqual([UNSTOCKED]);
      expect(untracked.emitted).toHaveLength(1);
      expect(untracked.emitted[0]).toMatchObject({
        orderId: ORDER,
        productIds: [UNSTOCKED],
        // Named, because the same order raises this twice and the second would otherwise
        // read as a duplicate of the first. The first is the actionable one.
        stage: 'CHECKOUT',
      });
    });

    it('a reservation with every product stocked stays quiet', async () => {
      await produkLine(PRODUCT_ID, 100);
      await inventory.reserveForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 1 }], ACTOR);
      expect(untracked.emitted).toHaveLength(0);
    });

    // Same contract as the completion alert: a failed warning must not fail the checkout.
    it('holds the stock even when the checkout alert throws', async () => {
      untracked.throws = true;
      await produkLine(PRODUCT_ID, 10);
      const result = await inventory.reserveForOrder(
        depotId,
        ORDER,
        [
          { productId: PRODUCT_ID, quantity: 4 },
          { productId: UNSTOCKED, quantity: 1 },
        ],
        ACTOR,
      );
      expect(result.reserved).toEqual([PRODUCT_ID]);
      expect(result.skipped).toEqual([UNSTOCKED]);
    });

    it('stays quiet when every product had a line', async () => {
      await produkLine(PRODUCT_ID, 100);
      await inventory.consumeForOrder(depotId, ORDER, [{ productId: PRODUCT_ID, quantity: 1 }], ACTOR);
      expect(untracked.emitted).toHaveLength(0);
    });

    // The warning is a side-effect of the sale, not a condition of it.
    it('completes the sale even when the alert throws', async () => {
      untracked.throws = true;
      await produkLine(PRODUCT_ID, 10);
      const result = await inventory.consumeForOrder(
        depotId,
        ORDER,
        [
          { productId: PRODUCT_ID, quantity: 4 },
          { productId: UNSTOCKED, quantity: 1 },
        ],
        ACTOR,
      );
      expect(result.consumed).toEqual([PRODUCT_ID]);
      expect((await inventory.get((await invRepo.listForDepot(depotId, {}))[0].id)).quantity).toBe(6);
    });
  });

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

  describe('restockForOrder', () => {
    it('puts a voided counter sale back on the shelf', async () => {
      const line = await produkLine(PRODUCT_ID, 100);
      await inventory.consumeForOrder(depotId, 'order-v', [{ productId: PRODUCT_ID, quantity: 3 }], ACTOR);
      expect((await inventory.get(line.id)).quantity).toBe(97);

      const result = await inventory.restockForOrder(
        depotId,
        'order-v',
        [{ productId: PRODUCT_ID, quantity: 3 }],
        ACTOR,
      );

      expect(result.restocked).toEqual([PRODUCT_ID]);
      expect((await inventory.get(line.id)).quantity).toBe(100);
    });

    // An ADJUSTMENT with no orderId: the unique (item, order) index already holds the sale's
    // own row, and reusing that key would erase the fact that the sale ever happened.
    it('leaves the original SALE movement intact beside the put-back', async () => {
      const line = await produkLine(PRODUCT_ID, 50);
      await inventory.consumeForOrder(depotId, 'order-w', [{ productId: PRODUCT_ID, quantity: 2 }], ACTOR);
      await inventory.restockForOrder(depotId, 'order-w', [{ productId: PRODUCT_ID, quantity: 2 }], ACTOR);

      const moves = await inventory.movements(line.id);
      const sale = moves.find((m) => m.type === StockMovementType.SALE);
      const back = moves.find((m) => m.type === StockMovementType.ADJUSTMENT);
      expect(sale?.delta).toBe(-2);
      expect(back?.delta).toBe(2);
      expect(back?.reason).toBe('Void order order-w');
    });

    it('skips a product this depot does not stock and a zero line, never erroring', async () => {
      const unstocked = '99999999-9999-9999-9999-999999999999';
      await produkLine(PRODUCT_ID, 10);
      const result = await inventory.restockForOrder(
        depotId,
        'order-x',
        [
          { productId: unstocked, quantity: 1 },
          { productId: PRODUCT_ID, quantity: 0 },
        ],
        ACTOR,
      );
      expect(result.restocked).toEqual([]);
      expect(result.skipped).toEqual([unstocked]);
    });

    it('rejects a depot that does not exist', async () => {
      await expect(
        inventory.restockForOrder('11111111-1111-4111-8111-111111111119', 'o', [], ACTOR),
      ).rejects.toBeInstanceOf(DepotNotFoundError);
    });
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
    await inventory.consumeForOrder(
      depotId,
      'order-3',
      [{ productId: PRODUCT_ID, quantity: 5 }],
      ACTOR,
    );
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
    await inventory.consumeForOrder(
      depotId,
      'order-low',
      [{ productId: PRODUCT_ID, quantity: 5 }],
      ACTOR,
      TOKEN,
    );
    expect(alerts.emitted).toHaveLength(0);
  });

  it('alerts when a SALE crosses a PRODUK line below minimum', async () => {
    await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.PRODUK,
        productId: PRODUCT_ID,
        label: 'Air RO',
        unit: 'unit',
        quantity: 12,
        minimumStock: 10,
      },
      ACTOR,
    );
    await inventory.consumeForOrder(
      depotId,
      'order-x',
      [{ productId: PRODUCT_ID, quantity: 5 }],
      ACTOR,
      TOKEN,
    ); // 12 -> 7
    expect(alerts.emitted).toHaveLength(1);
    expect(alerts.emitted[0].alert.quantity).toBe(7);
  });

  const ORDER = '44444444-4444-4444-4444-444444444444';

  it('reserves stock, reducing available without touching physical quantity', async () => {
    const line = await produkLine(PRODUCT_ID, 10);
    const result = await inventory.reserveForOrder(
      depotId,
      ORDER,
      [{ productId: PRODUCT_ID, quantity: 3 }],
      ACTOR,
    );
    expect(result.reserved).toEqual([PRODUCT_ID]);
    const view = await inventory.get(line.id);
    expect(view.quantity).toBe(10);
    expect(view.reserved).toBe(3);
    expect(view.available).toBe(7);
  });

  it('alerts when a reservation crosses a line into sellable-low, before physical stock drops', async () => {
    await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.PRODUK,
        productId: PRODUCT_ID,
        label: 'Air RO',
        unit: 'unit',
        quantity: 10,
        minimumStock: 8,
      },
      ACTOR,
    );
    await inventory.reserveForOrder(
      depotId,
      ORDER,
      [{ productId: PRODUCT_ID, quantity: 3 }],
      ACTOR,
      TOKEN,
    );
    // available 10 -> 7 (<= 8) though physical quantity is still 10
    expect(alerts.emitted).toHaveLength(1);
    expect(alerts.emitted[0].alert.quantity).toBe(7);
  });

  it('does not re-alert when a reserved sale merely converts a hold into a deduction', async () => {
    await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.PRODUK,
        productId: PRODUCT_ID,
        label: 'Air RO',
        unit: 'unit',
        quantity: 10,
        minimumStock: 8,
      },
      ACTOR,
    );
    const items = [{ productId: PRODUCT_ID, quantity: 3 }];
    await inventory.reserveForOrder(depotId, ORDER, items, ACTOR, TOKEN); // available 10->7, alerts once
    await inventory.consumeForOrder(depotId, ORDER, items, ACTOR, TOKEN); // available stays 7 (7-0)
    expect(alerts.emitted).toHaveLength(1); // no second alert
  });

  it('lists a line as low when reservations exhaust sellable stock (physical still on hand)', async () => {
    const line = await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.PRODUK,
        productId: PRODUCT_ID,
        label: 'Air RO',
        unit: 'unit',
        quantity: 10,
        minimumStock: 8,
      },
      ACTOR,
    );
    await inventory.reserveForOrder(
      depotId,
      ORDER,
      [{ productId: PRODUCT_ID, quantity: 3 }],
      ACTOR,
      TOKEN,
    );
    expect((await inventory.get(line.id)).lowStock).toBe(true); // available 7 <= 8
    const low = await inventory.listLowStock(depotId);
    expect(low.map((l) => l.id)).toContain(line.id);
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
    catalog.products.set(other, {
      id: other,
      name: 'B',
      sku: 'B-1',
      unit: 'unit',
      active: true,
    });
    const a = await produkLine(PRODUCT_ID, 10);
    const b = await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.PRODUK,
        productId: other,
        label: 'B',
        unit: 'unit',
        quantity: 1,
        minimumStock: 0,
      },
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
      {
        itemType: InventoryItemType.PRODUK,
        productId: PRODUCT_ID,
        label: 'Air RO',
        unit: 'unit',
        quantity: 0,
        minimumStock: 0,
        sellPrice: 22000,
      },
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

  it('summarizes wastage from negative ADJUSTMENT movements, valuing only priced lines', async () => {
    const produk = await inventory.createLine(
      depotId,
      {
        itemType: InventoryItemType.PRODUK,
        productId: PRODUCT_ID,
        label: 'Air RO',
        unit: 'unit',
        quantity: 100,
        minimumStock: 0,
        sellPrice: 5000,
      },
      ACTOR,
    );
    const galon = await inventory.createLine(depotId, raw(), ACTOR); // GALON 'Galon 19L', no sellPrice
    await inventory.adjust(produk.id, -4, 'pecah', ACTOR); // priced loss
    await inventory.adjust(produk.id, -1, 'pecah', ACTOR); // priced loss (5 total)
    await inventory.adjust(galon.id, -3, 'bocor', ACTOR); // unpriced loss
    await inventory.adjust(galon.id, 10, 'restock', ACTOR); // positive adjust must be ignored

    const summary = await inventory.wastageSummary(depotId);
    expect(summary.totalLossIdr).toBe(25000); // 5 units × 5000; galon has no price
    const byLabel = Object.fromEntries(summary.byItem.map((i) => [i.label, i]));
    // 'Air RO' was typed above; the catalog's own name wins on a PRODUK line, which is
    // the whole point of validating the id — the report reads the same word the catalog does.
    expect(byLabel['Air Galon 19L']).toEqual({ label: 'Air Galon 19L', qty: 5, lossIdr: 25000 });
    expect(byLabel['Galon 19L']).toEqual({ label: 'Galon 19L', qty: 3 }); // qty only, no lossIdr
    // Sorted by lost quantity, descending.
    expect(summary.byItem[0].label).toBe('Air Galon 19L');
  });

  it('returns an empty wastage summary (no priced total) when nothing was adjusted down', async () => {
    await inventory.createLine(depotId, raw(), ACTOR);
    const summary = await inventory.wastageSummary(depotId);
    expect(summary.byItem).toEqual([]);
    expect(summary.totalLossIdr).toBeUndefined();
  });

  it('windows wastage to the given range', async () => {
    const line = await produkLine(PRODUCT_ID, 100);
    await inventory.adjust(line.id, -2, 'pecah', ACTOR);
    const summary = await inventory.wastageSummary(depotId, new Date('2099-01-01T00:00:00.000Z'));
    expect(summary.byItem).toEqual([]);
  });

  it('echoes both window bounds it was given', async () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');
    const summary = await inventory.wastageSummary(depotId, from, to);
    expect(summary).toMatchObject({ from: from.toISOString(), to: to.toISOString() });
  });

  it('raises no variance approval when the physical count matches the system', async () => {
    const line = await produkLine(PRODUCT_ID, 10);
    await inventory.opname(line.id, 10, null, ACTOR, TOKEN);
    const moves = await inventory.movements(line.id);
    expect(moves[0].delta).toBe(0);
  });

  it('names the depot by id when the depot row cannot be read back for the alert', async () => {
    const line = await inventory.createLine(
      depotId,
      { ...raw(), quantity: 30, minimumStock: 20 },
      ACTOR,
    );
    jest.spyOn(depotRepo, 'findById').mockResolvedValue(null);
    await inventory.adjust(line.id, -15, 'pecah', ACTOR, TOKEN);
    expect(alerts.emitted.at(-1)?.alert.depotName).toBe(depotId);
  });

  it('returns a standard page of depot-wide movements', async () => {
    const line = await inventory.createLine(depotId, raw(), ACTOR);
    await inventory.adjust(line.id, -2, 'counted', ACTOR);

    const result = await inventory.listMovementsForDepot(depotId, {
      type: StockMovementType.ADJUSTMENT,
      page: 1,
      limit: 1,
    });

    expect(result).toMatchObject({ total: 1, page: 1, limit: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({
      itemLabel: 'Galon 19L',
      itemType: InventoryItemType.GALON,
      type: StockMovementType.ADJUSTMENT,
    });
  });
  // AUTHZ-A1: every by-id stock operation used to load the row by UUID alone. A depot head
  // who knew another depot's line id (the movements export hands them out) could count it
  // to zero, and the shrinkage landed on that depot's books. One check inside `require`,
  // which all seven of these route through.
  describe('by-id operations refuse a line that belongs to another depot', () => {
    const outsider = {
      sub: 'kepala-depot-lain',
      role: Role.KEPALA_DEPOT,
      depotId: '99999999-9999-9999-9999-999999999999',
    } as AuthenticatedUser;

    it('refuses read, write, and count for a foreign depot head', async () => {
      const line = await inventory.createLine(depotId, raw(), ACTOR);

      await expect(inventory.get(line.id, outsider)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(inventory.movements(line.id, outsider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(inventory.listReservations(line.id, outsider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        inventory.updateMeta(line.id, { label: 'dirampas' }, outsider),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        inventory.adjust(line.id, -100, null, ACTOR, TOKEN, outsider),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        inventory.opname(line.id, 0, null, ACTOR, TOKEN, outsider),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(inventory.deleteLine(line.id, outsider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      // and the stock is untouched by all of that
      expect((await inventory.get(line.id)).quantity).toBe(100);
    });

    it('still serves the depot head the line belongs to', async () => {
      const line = await inventory.createLine(depotId, raw(), ACTOR);
      const insider = { sub: 'kepala', role: Role.KEPALA_DEPOT, depotId } as AuthenticatedUser;

      await expect(inventory.get(line.id, insider)).resolves.toMatchObject({ quantity: 100 });
      await expect(inventory.opname(line.id, 90, null, ACTOR, TOKEN, insider)).resolves.toMatchObject(
        { quantity: 90 },
      );
    });
  });
});
