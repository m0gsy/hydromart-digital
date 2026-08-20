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

  /**
   * C10: DISPUTED used to be here as `false`, and that WAS the bug this test enforced.
   * `dispute()` writes the status, nothing else writes any other, so a deposit parked for
   * offline resolution could never be resolved and the money hung permanently. A dispute is
   * resolvable — that is the whole point of parking it. VERIFIED stays closed: it is done.
   */
  it('a submitted or disputed settlement can be resolved; a verified one is done', () => {
    expect(canResolve(SettlementStatus.SUBMITTED)).toBe(true);
    expect(canResolve(SettlementStatus.VERIFIED)).toBe(false);
    expect(canResolve(SettlementStatus.DISPUTED)).toBe(true);
  });
});
