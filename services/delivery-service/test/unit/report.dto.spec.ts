import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DepotTeamReportQueryDto } from '../../src/modules/dto/report.dto';

describe('DepotTeamReportQueryDto', () => {
  it('accepts a depot UUID with optional ISO range bounds', async () => {
    const dto = plainToInstance(DepotTeamReportQueryDto, {
      depotId: '00000000-0000-4000-8000-000000000001',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid depot id and date bound', async () => {
    const dto = plainToInstance(DepotTeamReportQueryDto, {
      depotId: 'depot-1',
      from: 'not-a-date',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual(['depotId', 'from']);
  });
});
