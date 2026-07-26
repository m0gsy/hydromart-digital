import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SegmentEstimateQueryDto, TopReportQueryDto } from '../../src/modules/dto/report.dto';

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
