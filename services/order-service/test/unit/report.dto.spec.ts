import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  RevenueExportPdfDto,
  SegmentEstimateQueryDto,
  TopReportQueryDto,
} from '../../src/modules/dto/report.dto';

// Query strings arrive as text — the @Type(() => Number) transforms must coerce them
// before @IsInt/@Min can pass.
describe('report query DTO number transforms', () => {
  it('coerces every SegmentEstimateQueryDto window to a number', async () => {
    const dto = plainToInstance(SegmentEstimateQueryDto, {
      recencyDays: '30',
      lapsedDays: '60',
      newWithinDays: '7',
      minOrders: '3',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      recencyDays: 30,
      lapsedDays: 60,
      newWithinDays: 7,
      minOrders: 3,
    });
  });

  it('rejects out-of-range segment windows', async () => {
    const errors = await validate(
      plainToInstance(SegmentEstimateQueryDto, { recencyDays: '0', minOrders: 'x' }),
    );
    expect(errors.map((error) => error.property).sort()).toEqual(['minOrders', 'recencyDays']);
  });

  it('coerces the top-report limit and enforces its 1..100 bounds', async () => {
    const dto = plainToInstance(TopReportQueryDto, { limit: '25' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(25);

    expect(await validate(plainToInstance(TopReportQueryDto, { limit: '101' }))).not.toHaveLength(
      0,
    );
  });
});

describe('RevenueExportPdfDto', () => {
  const base = { group: 'depot', from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' };

  it('accepts a valid body with its nested rows', async () => {
    const dto = plainToInstance(RevenueExportPdfDto, {
      ...base,
      rows: [{ label: 'Depot A', orders: 10, revenue: 400000 }],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a group outside the three known ones', async () => {
    const errors = await validate(
      plainToInstance(RevenueExportPdfDto, { ...base, group: 'depotxx', rows: [] }),
    );
    expect(errors.map((e) => e.property)).toContain('group');
  });

  it('rejects a row missing its label or carrying a non-numeric figure', async () => {
    const errors = await validate(
      plainToInstance(RevenueExportPdfDto, {
        ...base,
        rows: [{ orders: 'ten', revenue: 400000 }],
      }),
      { validationError: { target: false } },
    );
    expect(errors.map((e) => e.property)).toContain('rows');
  });

  it('caps the row count at 200', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ label: `Row ${i}`, orders: 1, revenue: 1 }));
    const errors = await validate(plainToInstance(RevenueExportPdfDto, { ...base, rows }));
    expect(errors.map((e) => e.property)).toContain('rows');
  });
});
