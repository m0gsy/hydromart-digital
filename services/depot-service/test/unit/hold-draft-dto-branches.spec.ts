import { plainToInstance } from 'class-transformer';

import { AiPriceOverrideDraftDto, AiPurchaseOrderDraftDto } from '../../src/modules/dto/ai-draft.dto';
import { ProposePriceOverrideDto } from '../../src/modules/dto/price-override.dto';
import {
  CreateLabTestDto,
  CreatePermitDto,
  StartQualityHoldDto,
} from '../../src/modules/dto/quality-hold.dto';

// The trim and round2 transforms hand a value they cannot work on to the validator untouched,
// so it is refused there instead of being coerced into something that passes.
describe('DTO transforms leave a value they cannot handle as it is', () => {
  it('trim keeps a non-string', () => {
    expect(plainToInstance(StartQualityHoldDto, { note: 5 }).note).toBe(5);
    expect(plainToInstance(CreateLabTestDto, { labName: 1, reportNo: 2 })).toMatchObject({ labName: 1, reportNo: 2 });
    expect(plainToInstance(CreatePermitDto, { kind: 3, number: 4 })).toMatchObject({ kind: 3, number: 4 });
    expect(plainToInstance(AiPriceOverrideDraftDto, { reason: 6 }).reason).toBe(6);
    expect(plainToInstance(AiPurchaseOrderDraftDto, { reason: 7 }).reason).toBe(7);
  });

  it('trim still trims a string', () => {
    expect(plainToInstance(StartQualityHoldDto, { note: '  ok  ' }).note).toBe('ok');
  });

  it('round2 keeps a value that is not a finite number', () => {
    expect(plainToInstance(ProposePriceOverrideDto, { currentPrice: 'abc', value: 'x' })).toMatchObject({
      currentPrice: 'abc',
      value: 'x',
    });
  });
});
