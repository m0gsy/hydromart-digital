import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateApprovalDto } from '../../src/modules/dto/approval.dto';
import { CreateDepotDto } from '../../src/modules/dto/depot.dto';

/*
 * A number past what its column holds used to reach Postgres and come back as 22003, a 500
 * (later a 422 from the gateway-wide net) that could not say which field was wrong. The DTO
 * now carries the column's own limit, so the 400 names the field before anything is written.
 */
const errorsOn = <T extends object>(cls: new () => T, body: object, field: string) =>
  validateSync(plainToInstance(cls, body), { skipMissingProperties: true })
    .filter((e) => e.property === field)
    .flatMap((e) => Object.keys(e.constraints ?? {}));

describe('DTO number bounds', () => {
  it('stops an int4 column at 2 147 483 647', () => {
    expect(errorsOn(CreateApprovalDto, { amountIdr: 2_147_483_647 }, 'amountIdr')).not.toContain('max');
    expect(errorsOn(CreateApprovalDto, { amountIdr: 2_147_483_648 }, 'amountIdr')).toContain('max');
  });

  it('stops a Decimal(12,2) column at what it holds', () => {
    expect(errorsOn(CreateDepotDto, { deliveryFee: 9_999_999_999 }, 'deliveryFee')).not.toContain('max');
    expect(errorsOn(CreateDepotDto, { deliveryFee: 10_000_000_000 }, 'deliveryFee')).toContain('max');
  });
});
