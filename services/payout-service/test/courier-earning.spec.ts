import { computeEarning, isPeak } from '../src/domain/courier-earning';

const RULE = {
  baseFare: 5000,
  peakBonus: 2000,
  onTimeBonus: 1000,
  peakStartHour: 17,
  peakEndHour: 20,
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
});
