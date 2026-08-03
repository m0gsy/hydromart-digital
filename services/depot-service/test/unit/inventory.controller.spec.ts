import { BadRequestException } from '@nestjs/common';

import { InventoryItemType, StockMovementType } from '../../src/domain/inventory';
import {
  DepotInventoryController,
  InventoryController,
} from '../../src/modules/inventory.controller';

describe('DepotInventoryController.movements', () => {
  const inventory = { listMovementsForDepot: jest.fn() };
  const controller = new DepotInventoryController(inventory as never, {} as never);

  beforeEach(() => inventory.listMovementsForDepot.mockReset().mockResolvedValue({ items: [] }));

  it('maps query values to the depot-wide movement service', async () => {
    await controller.movements('00000000-0000-4000-8000-000000000001', {
      type: StockMovementType.SALE,
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      page: 2,
      limit: 50,
    });

    expect(inventory.listMovementsForDepot).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      {
        type: StockMovementType.SALE,
        from: new Date('2026-07-01T00:00:00.000Z'),
        to: new Date('2026-08-01T00:00:00.000Z'),
        page: 2,
        limit: 50,
      },
    );
  });

  it('rejects an empty or reversed [from,to) window', () => {
    expect(() =>
      controller.movements('00000000-0000-4000-8000-000000000001', {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });
});

describe('DepotInventoryController.import', () => {
  const inventory = { importLines: jest.fn() };
  const controller = new DepotInventoryController(inventory as never, {} as never);
  const DEPOT = '00000000-0000-4000-8000-000000000001';

  it('defaults the optional columns a CSV may leave blank', async () => {
    inventory.importLines.mockResolvedValue({ created: 1, skipped: 0, failed: 0, results: [] });

    await controller.import(
      DEPOT,
      { rows: [{ itemType: InventoryItemType.GALON, label: 'Galon 19L', unit: 'unit' }] } as never,
      { sub: 'staff-1' } as never,
    );

    expect(inventory.importLines).toHaveBeenCalledWith(
      DEPOT,
      [
        {
          itemType: InventoryItemType.GALON,
          productId: null,
          sku: null,
          label: 'Galon 19L',
          unit: 'unit',
          quantity: 0,
          minimumStock: 0,
          sellPrice: null,
        },
      ],
      'staff-1',
    );
  });
});

// The single-line controller: everything here is addressed by the line's own id.
describe('InventoryController line operations', () => {
  const inventory = {
    applyProductChange: jest.fn(),
    listReservations: jest.fn(),
    deleteLine: jest.fn(),
  };
  const controller = new InventoryController(inventory as never);

  beforeEach(() => jest.clearAllMocks());

  it('passes a catalog change straight through to the service', async () => {
    inventory.applyProductChange.mockResolvedValue({ renamed: 2, hidden: 0 });
    const dto = { productId: 'p1', name: 'Air Galon 19,2L', unit: 'Galon', active: true };
    await expect(controller.productChanged(dto)).resolves.toEqual({ renamed: 2, hidden: 0 });
    expect(inventory.applyProductChange).toHaveBeenCalledWith(dto);
  });

  it('reads the active holds on a line', async () => {
    inventory.listReservations.mockResolvedValue([]);
    await controller.reservations('it-1');
    expect(inventory.listReservations).toHaveBeenCalledWith('it-1');
  });

  it('deletes a line by id', async () => {
    inventory.deleteLine.mockResolvedValue(undefined);
    await controller.remove('it-1');
    expect(inventory.deleteLine).toHaveBeenCalledWith('it-1');
  });
});
