import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  LimitQueryDto,
  RebuildQueryDto,
  TrendingQueryDto,
} from '../../src/modules/dto/recommendation.dto';

// Query strings arrive as text — the @Type(() => Number) transforms must coerce them
// before @IsInt/@Min can pass.
describe('recommendation query DTO number transforms', () => {
  it('coerces the plain limit query', async () => {
    const dto = plainToInstance(LimitQueryDto, { limit: '5' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(5);
  });

  it('coerces the trending window and limit', async () => {
    const dto = plainToInstance(TrendingQueryDto, {
      depotId: '00000000-0000-4000-8000-000000000001',
      days: '14',
      limit: '20',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ days: 14, limit: 20 });
  });

  it('coerces the rebuild page size and rejects a sub-minimum value', async () => {
    const dto = plainToInstance(RebuildQueryDto, { limit: '250' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(250);

    expect(await validate(plainToInstance(RebuildQueryDto, { limit: '0' }))).not.toHaveLength(0);
  });
});
