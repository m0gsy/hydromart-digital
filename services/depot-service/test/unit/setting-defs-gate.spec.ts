import { SETTING_DEF_BY_KEY } from '../../src/config/setting-defs';

// DEP-31: any depot admin could change the gallon deposit, and a refund then uses the CURRENT
// rate rather than the one the customer paid. Money rates that other roles' decisions hang off
// are head-office decisions, like the approval auto-pass limit.
describe('setting definitions', () => {
  it('only head office may change the gallon deposit rate', () => {
    expect(SETTING_DEF_BY_KEY.gallonDepositIdr?.requires).toBe('approvalThresholdWrite');
  });
});
