import {
  SettlementStatus,
  canResolve,
  computeVariance,
  isShortfall,
} from '../../src/domain/settlement';

describe('settlement domain', () => {
  it('variance is deposited minus expected', () => {
    expect(computeVariance(75000, 75000)).toBe(0);
    expect(computeVariance(75000, 60000)).toBe(-15000);
    expect(computeVariance(75000, 80000)).toBe(5000);
  });

  it('only a negative variance is a shortfall', () => {
    expect(isShortfall(-15000)).toBe(true);
    expect(isShortfall(0)).toBe(false);
    expect(isShortfall(5000)).toBe(false);
  });

  it('only a just-submitted settlement can be resolved', () => {
    expect(canResolve(SettlementStatus.SUBMITTED)).toBe(true);
    expect(canResolve(SettlementStatus.VERIFIED)).toBe(false);
    expect(canResolve(SettlementStatus.DISPUTED)).toBe(false);
  });
});
