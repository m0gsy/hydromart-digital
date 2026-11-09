import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DisputeSettlementDto, SubmitSettlementDto } from '../../src/modules/dto/settlement.dto';

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

// DLV-17: a deposit beyond the 32-bit column became a database error (500), not a 422.
describe('SubmitSettlementDto · depositedAmount ceiling', () => {
  const errorsFor = (depositedAmount: unknown) =>
    validate(plainToInstance(SubmitSettlementDto, { shiftId: '7d0f5ff1-0b8f-4e1a-9d63-0f4a0f2f9a11', depositedAmount }));

  it('accepts an ordinary deposit and the column maximum', async () => {
    expect(await errorsFor(150_000)).toHaveLength(0);
    expect(await errorsFor(2_147_483_647)).toHaveLength(0);
  });

  it('rejects one past the column, and a negative', async () => {
    expect(await errorsFor(2_147_483_648)).not.toHaveLength(0);
    expect(await errorsFor(-1)).not.toHaveLength(0);
  });
});
