import { validate } from 'class-validator';

import { OperationalCostQueryDto } from '../../src/modules/dto/operational-report.dto';

describe('OperationalCostQueryDto', () => {
  it('accepts a UUID depot and ISO bounds', async () => {
    const dto = Object.assign(new OperationalCostQueryDto(), {
      depotId: '11111111-1111-4111-8111-111111111111',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects missing or malformed inputs', async () => {
    const dto = Object.assign(new OperationalCostQueryDto(), {
      depotId: 'not-a-uuid',
      from: 'July',
      to: '',
    });
    expect((await validate(dto)).length).toBeGreaterThanOrEqual(3);
  });
});
