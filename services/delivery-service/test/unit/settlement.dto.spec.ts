import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DisputeSettlementDto } from '../../src/modules/dto/settlement.dto';

describe('DisputeSettlementDto', () => {
  const errorsFor = (note: unknown) =>
    validate(plainToInstance(DisputeSettlementDto, { note }));

  it('accepts a real note', async () => {
    expect(await errorsFor('Hitungan kurir dan kasir berbeda.')).toHaveLength(0);
  });

  it.each(['', '   ', '\n\t '])('rejects a blank note %j', async (note) => {
    expect(await errorsFor(note)).not.toHaveLength(0);
  });
});
