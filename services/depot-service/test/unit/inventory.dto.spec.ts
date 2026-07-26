import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { InventoryItemType, StockMovementType } from '../../src/domain/inventory';
import {
  CreateInventoryItemDto,
  ListInventoryQueryDto,
  ListStockMovementsQueryDto,
  UpdateInventoryItemDto,
} from '../../src/modules/dto/inventory.dto';

describe('ListStockMovementsQueryDto', () => {
  it('accepts enum/date/pagination query values and transforms numbers', async () => {
    const dto = plainToInstance(ListStockMovementsQueryDto, {
      type: StockMovementType.RECEIPT,
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      page: '2',
      limit: '50',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ page: 2, limit: 50 });
  });

  it('rejects invalid enum/date/pagination values', async () => {
    const dto = plainToInstance(ListStockMovementsQueryDto, {
      type: 'TRANSFER',
      from: 'not-a-date',
      page: '0',
      limit: '101',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual(['from', 'limit', 'page', 'type']);
  });
});

describe('inventory write/query DTO transforms', () => {
  it('coerces the lowStockOnly query flag to a boolean', async () => {
    const dto = plainToInstance(ListInventoryQueryDto, {
      itemType: InventoryItemType.GALON,
      lowStockOnly: 'true',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.lowStockOnly).toBe(true);
  });

  it('coerces create quantity/minimumStock/sellPrice to numbers', async () => {
    const dto = plainToInstance(CreateInventoryItemDto, {
      itemType: InventoryItemType.PRODUK,
      label: 'Galon 19L',
      unit: 'unit',
      quantity: '100',
      minimumStock: '20',
      sellPrice: '22000',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ quantity: 100, minimumStock: 20, sellPrice: 22000 });
  });

  it('coerces update minimumStock/sellPrice to numbers', async () => {
    const dto = plainToInstance(UpdateInventoryItemDto, {
      minimumStock: '5',
      sellPrice: '18000',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ minimumStock: 5, sellPrice: 18000 });
  });
});
