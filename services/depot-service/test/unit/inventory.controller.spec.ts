import { BadRequestException } from '@nestjs/common';

import { StockMovementType } from '../../src/domain/inventory';
import { DepotInventoryController } from '../../src/modules/inventory.controller';

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
