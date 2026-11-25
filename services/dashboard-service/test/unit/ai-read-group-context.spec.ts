import { isOpen, settledFrom } from '../../src/application/ai-read/group-context';

describe('settledFrom: a closed month is answered from the 8th of the next one (owner decision 25 Nov 2026)', () => {
  it.each([
    ['2026-11-30', '2026-12-08'],
    ['2026-03-31', '2026-04-08'],
    ['2026-12-31', '2027-01-08'],
    ['2026-06-15', '2026-07-08'], // a period ending mid-month: still the month after it
  ])('%s -> %s', (to, from) => {
    expect(settledFrom(to)).toBe(from);
  });

  it('isOpen: held through the 7th of the next month, answered from the 8th', () => {
    const period = { to: '2026-11-30' };
    expect(isOpen({ period, today: '2026-11-25' })).toBe(true);
    expect(isOpen({ period, today: '2026-12-07' })).toBe(true);
    expect(isOpen({ period, today: '2026-12-08' })).toBe(false);
    expect(isOpen({ period: { to: '2026-12-31' }, today: '2027-01-07' })).toBe(true);
    expect(isOpen({ period: { to: '2026-12-31' }, today: '2027-01-08' })).toBe(false);
  });
});
