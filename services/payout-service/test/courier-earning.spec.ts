import { computeEarning, isPeak, tiersReached, tiersValid } from '../src/domain/courier-earning';

const RULE = {
  baseFare: 5000,
  peakBonus: 2000,
  onTimeBonus: 1000,
  peakStartHour: 17,
  peakEndHour: 20,
  monthlyTarget: 5_000_000,
  tiers: [
    { deliveries: 25, bonus: 25_000 },
    { deliveries: 40, bonus: 60_000 },
  ],
};

describe('courier earning domain', () => {
  it('marks hours inside [start, end) as peak', () => {
    expect(isPeak(17, 17, 20)).toBe(true);
    expect(isPeak(19, 17, 20)).toBe(true);
    expect(isPeak(20, 17, 20)).toBe(false); // end is exclusive
    expect(isPeak(16, 17, 20)).toBe(false);
  });

  it('treats a midnight-crossing window as empty (non-wrapping)', () => {
    expect(isPeak(23, 22, 2)).toBe(false);
    expect(isPeak(1, 22, 2)).toBe(false);
  });

  it('pays base only for an off-peak late delivery', () => {
    expect(computeEarning(RULE, { hour: 10, onTime: false })).toBe(5000);
  });

  it('adds the on-time bonus when the delivery beat its SLA', () => {
    expect(computeEarning(RULE, { hour: 10, onTime: true })).toBe(6000);
  });

  it('stacks the peak and on-time bonuses', () => {
    expect(computeEarning(RULE, { hour: 18, onTime: true })).toBe(8000);
  });

  it('returns every rung reached at a delivery count, ascending', () => {
    expect(tiersReached(RULE.tiers, 24)).toEqual([]);
    expect(tiersReached(RULE.tiers, 25)).toEqual([{ deliveries: 25, bonus: 25_000 }]); // boundary is inclusive
    expect(tiersReached(RULE.tiers, 41)).toHaveLength(2);
    expect(tiersReached([{ deliveries: 40, bonus: 1 }, { deliveries: 25, bonus: 2 }], 40)[0].deliveries).toBe(25);
  });

  it('rejects a ladder with duplicate or non-positive delivery counts', () => {
    expect(tiersValid(RULE.tiers)).toBe(true);
    expect(tiersValid([])).toBe(true);
    expect(tiersValid([{ deliveries: 0, bonus: 1000 }])).toBe(false);
    expect(tiersValid([{ deliveries: 25, bonus: 1 }, { deliveries: 25, bonus: 2 }])).toBe(false);
    expect(tiersValid([{ deliveries: 25, bonus: -1 }])).toBe(false);
  });
});
