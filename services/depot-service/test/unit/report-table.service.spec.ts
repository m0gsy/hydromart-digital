import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  InventoryRepository,
  StockSnapshotRow,
} from '../../src/application/ports/inventory.repository';
import { ReportTableService } from '../../src/application/services/report-table.service';
import { ReportTableQueryDto } from '../../src/modules/dto/report-table.dto';

const row = (over: Partial<StockSnapshotRow> = {}): StockSnapshotRow => ({
  depotCode: 'JKT-01',
  depotName: 'Jakarta',
  label: 'Galon 19L',
  unit: 'pcs',
  quantity: 20,
  reserved: 0,
  minimumStock: 5,
  lastMovementAt: new Date('2026-07-01T00:00:00.000Z'),
  ...over,
});

function make(rows: StockSnapshotRow[]) {
  const stockSnapshot = jest.fn().mockResolvedValue(rows);
  const service = new ReportTableService({ stockSnapshot } as unknown as InventoryRepository);
  return { service, stockSnapshot };
}

describe('ReportTableService.stockLevels', () => {
  it('aligns every row with its columns and classifies availability', async () => {
    const { service } = make([
      row(),
      row({ label: 'Tutup', quantity: 6, reserved: 2, minimumStock: 5 }),
      row({ label: 'Segel', quantity: 3, reserved: 3, lastMovementAt: null }),
    ]);
    const t = await service.stockLevels();
    expect(t.rows.every((r) => r.length === t.columns.length)).toBe(true);
    expect(t.rows.map((r) => r[7])).toEqual(['AMAN', 'RENDAH', 'HABIS']);
    expect(t.rows[0]).toEqual([
      'JKT-01 · Jakarta',
      'Galon 19L',
      'pcs',
      20,
      0,
      20,
      5,
      'AMAN',
      '2026-07-01T00:00:00.000Z',
    ]);
    expect(t.rows[2][8]).toBeNull();
    expect(t.truncated).toBe(false);
  });

  it('fetches one past the cap and flags truncation without returning the extra row', async () => {
    const cap = ReportTableService.ROW_CAP;
    const { service, stockSnapshot } = make(Array.from({ length: cap + 1 }, () => row()));
    const t = await service.stockLevels();
    expect(stockSnapshot).toHaveBeenCalledWith(cap + 1);
    expect(t.rows).toHaveLength(cap);
    expect(t.truncated).toBe(true);
  });
});

describe('ReportTableQueryDto', () => {
  const check = (dataset: string) =>
    validate(
      plainToInstance(ReportTableQueryDto, {
        dataset,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    );

  it('accepts the stock dataset', async () => {
    expect(await check('STOCK_LEVELS')).toHaveLength(0);
  });

  it('rejects datasets this service does not own, meter readings included', async () => {
    expect(await check('METER_READINGS')).toHaveLength(1);
    expect(await check('NOPE')).toHaveLength(1);
  });
});
