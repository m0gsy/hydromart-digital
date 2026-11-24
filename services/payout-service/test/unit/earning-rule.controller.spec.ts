import { PayoutConfigService } from '../../src/config/payout-config.service';
import { EarningRuleController } from '../../src/modules/earning-rule.controller';
import { CourierPayoutService } from '../../src/application/services/courier-payout.service';
import { ApplyEarningRuleDto } from '../../src/modules/dto/earning-rule.dto';

describe('EarningRuleController', () => {
  const payout = {
    listEarningRules: jest.fn().mockResolvedValue([]),
    applyEarningRule: jest.fn().mockResolvedValue({ id: 'r1' }),
  };
  const controller = new EarningRuleController(
    payout as unknown as CourierPayoutService,
    { businessTimeZone: 'Asia/Jakarta' } as unknown as PayoutConfigService,
  );
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
    } as ApplyEarningRuleDto, { sub: 'hq-1' } as never);
    expect(payout.applyEarningRule).toHaveBeenCalledWith({
      createdBy: 'hq-1',
      depotId: 'd1',
      baseFare: 5000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 0,
      tiers: [],
      // date-only = start of that day in WIB (17:00Z the day before), not 00:00Z
      effectiveDate: new Date('2026-07-31T17:00:00.000Z'),
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
    } as ApplyEarningRuleDto, { sub: 'hq-1' } as never);
    expect(payout.applyEarningRule).toHaveBeenCalledWith(
      expect.objectContaining({ depotId: null }),
    );
  });

  it('keeps a full ISO timestamp as the instant it is', async () => {
    await controller.apply({
      baseFare: 1, peakBonus: 1, onTimeBonus: 1, peakStartHour: 1, peakEndHour: 2,
      effectiveDate: '2026-08-01T00:00:00.000Z',
    } as ApplyEarningRuleDto, { sub: 'hq-1' } as never);
    expect(payout.applyEarningRule).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: new Date('2026-08-01T00:00:00.000Z') }),
    );
  });
});
