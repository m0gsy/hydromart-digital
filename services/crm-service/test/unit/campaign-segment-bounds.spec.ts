import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CampaignSegmentDto } from '../../src/modules/dto/campaign.dto';

/*
 * A day span becomes a timestamp in SQL; one past what a timestamp can hold fails with 22008,
 * which the gateway-wide 22003 net does not catch. One hundred years is the bound.
 */
const errorsOn = (body: object, field: string) =>
  validateSync(plainToInstance(CampaignSegmentDto, body), { skipMissingProperties: true })
    .filter((e) => e.property === field)
    .flatMap((e) => Object.keys(e.constraints ?? {}));

describe('CampaignSegmentDto bounds', () => {
  it('takes a span up to one hundred years, and refuses one past it', () => {
    expect(errorsOn({ recencyDays: 36_500 }, 'recencyDays')).not.toContain('max');
    expect(errorsOn({ recencyDays: 36_501 }, 'recencyDays')).toContain('max');
  });
});
