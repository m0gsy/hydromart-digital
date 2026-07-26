import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  ChurnQueryDto,
  DemandQueryDto,
  DepotRollupQueryDto,
  IngestDto,
  IngestItemDto,
  RebuildQueryDto,
  SalesQueryDto,
} from '../../src/modules/dto/forecast.dto';

// Drives every DTO through plainToInstance so the @Type(() => Number|IngestItemDto) factory
// closures actually run (they only execute during transformation), then validateSync to walk
// the class-validator decorators. Valid + invalid input covers the pass/fail branches.

const UUID = '11111111-1111-4111-8111-111111111111';

describe('forecast DTOs', () => {
  it('coerces DemandQueryDto numeric strings and validates a well-formed instance', () => {
    const dto = plainToInstance(DemandQueryDto, { productId: UUID, depotId: UUID, historyDays: '30', horizonDays: '7' });
    expect(dto.historyDays).toBe(30);
    expect(dto.horizonDays).toBe(7);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('flags an out-of-range / malformed DemandQueryDto', () => {
    const dto = plainToInstance(DemandQueryDto, { productId: 'not-a-uuid', historyDays: '5', horizonDays: '999' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('coerces DepotRollupQueryDto (history/horizon/limit)', () => {
    const dto = plainToInstance(DepotRollupQueryDto, { historyDays: '60', horizonDays: '14', limit: '5' });
    expect(dto).toMatchObject({ historyDays: 60, horizonDays: 14, limit: 5 });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('coerces SalesQueryDto and accepts an omitted depot', () => {
    const dto = plainToInstance(SalesQueryDto, { historyDays: '30', horizonDays: '7' });
    expect(dto.depotId).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('coerces ChurnQueryDto (limit/days)', () => {
    const dto = plainToInstance(ChurnQueryDto, { depotId: UUID, limit: '50', days: '45' });
    expect(dto).toMatchObject({ limit: 50, days: 45 });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('coerces RebuildQueryDto limit', () => {
    const dto = plainToInstance(RebuildQueryDto, { limit: '100' });
    expect(dto.limit).toBe(100);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('validates the nested IngestDto items array via the @Type(IngestItemDto) factory', () => {
    const dto = plainToInstance(IngestDto, {
      orderId: UUID,
      customerId: UUID,
      depotId: null,
      total: 85000,
      items: [{ productId: UUID, productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon', quantity: 3 }],
    });
    expect(dto.items[0]).toBeInstanceOf(IngestItemDto);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an IngestDto with an empty items array and a bad nested item', () => {
    expect(validateSync(plainToInstance(IngestDto, { orderId: UUID, customerId: UUID, total: 0, items: [] })).length).toBeGreaterThan(0);
    const badNested = plainToInstance(IngestDto, {
      orderId: UUID,
      customerId: UUID,
      total: 100,
      items: [{ productId: 'bad', productName: 1, sku: '', unit: '', quantity: 0 }],
    });
    expect(validateSync(badNested).length).toBeGreaterThan(0);
  });
});
