import { EarningRuleController } from '../../src/modules/earning-rule.controller';
import { CourierPayoutService } from '../../src/application/services/courier-payout.service';
import { ApplyEarningRuleDto } from '../../src/modules/dto/earning-rule.dto';

describe('EarningRuleController', () => {
  const payout = {
    listEarningRules: jest.fn().mockResolvedValue([]),
    applyEarningRule: jest.fn().mockResolvedValue({ id: 'r1' }),
  };
  const controller = new EarningRuleController(payout as unknown as CourierPayoutService);
  afterEach(() => jest.clearAllMocks());

  it('list delegates to listEarningRules', async () => {
    await controller.list();
    expect(payout.listEarningRules).toHaveBeenCalledWith();
  });

  it('apply maps dto with provided depotId + Date', async () => {
    await controller.apply({
      depotId: 'd1',
      baseFare: 5000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      effectiveDate: '2026-08-01',
    } as ApplyEarningRuleDto);
    expect(payout.applyEarningRule).toHaveBeenCalledWith({
      depotId: 'd1',
      baseFare: 5000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 0,
      tiers: [],
      effectiveDate: new Date('2026-08-01'),
    });
  });

  it('apply falls back to null depotId when omitted', async () => {
    await controller.apply({
      baseFare: 5000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      effectiveDate: '2026-08-01',
    } as ApplyEarningRuleDto);
    expect(payout.applyEarningRule).toHaveBeenCalledWith(
      expect.objectContaining({ depotId: null }),
    );
  });
});
