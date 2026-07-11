import {
  PricingAdjustType,
  PricingRuleRecord,
  isRuleActive,
  localParts,
  resolveRule,
} from '../../src/domain/pricing-rule';

const TZ = 'Asia/Jakarta'; // UTC+7, no DST

function rule(over: Partial<PricingRuleRecord>): PricingRuleRecord {
  return {
    id: 'r1',
    depotId: 'd1',
    productId: null,
    adjustType: PricingAdjustType.PERCENT,
    value: -10,
    daysOfWeek: [],
    startMinute: null,
    endMinute: null,
    validFrom: null,
    validUntil: null,
    priority: 0,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('localParts', () => {
  it('converts UTC to the depot timezone weekday + minute', () => {
    // 2026-07-11 is a Saturday. 02:30 UTC = 09:30 WIB (UTC+7) → still Saturday.
    const p = localParts(new Date('2026-07-11T02:30:00Z'), TZ);
    expect(p.weekday).toBe(6); // Saturday
    expect(p.minute).toBe(9 * 60 + 30);
  });

  it('rolls the weekday forward across the UTC/local date boundary', () => {
    // 2026-07-11 20:00 UTC = 2026-07-12 03:00 WIB → Sunday.
    const p = localParts(new Date('2026-07-11T20:00:00Z'), TZ);
    expect(p.weekday).toBe(0); // Sunday
    expect(p.minute).toBe(3 * 60);
  });
});

describe('isRuleActive', () => {
  const now = new Date('2026-07-11T05:00:00Z'); // 12:00 WIB Saturday, minute 720

  it('is active with no window constraints', () => {
    expect(isRuleActive(rule({}), now, TZ)).toBe(true);
  });

  it('is inactive when the flag is off', () => {
    expect(isRuleActive(rule({ active: false }), now, TZ)).toBe(false);
  });

  it('matches only listed days of week', () => {
    expect(isRuleActive(rule({ daysOfWeek: [6] }), now, TZ)).toBe(true); // Sat
    expect(isRuleActive(rule({ daysOfWeek: [1, 2] }), now, TZ)).toBe(false);
  });

  it('matches the time-of-day window (end exclusive)', () => {
    expect(isRuleActive(rule({ startMinute: 600, endMinute: 780 }), now, TZ)).toBe(true); // 10:00–13:00
    expect(isRuleActive(rule({ startMinute: 0, endMinute: 720 }), now, TZ)).toBe(false); // ends at 12:00 (exclusive)
  });

  it('matches the valid date range (inclusive)', () => {
    expect(isRuleActive(rule({ validFrom: new Date('2026-07-01T00:00:00Z') }), now, TZ)).toBe(true);
    expect(isRuleActive(rule({ validUntil: new Date('2026-07-01T00:00:00Z') }), now, TZ)).toBe(false);
  });
});

describe('resolveRule', () => {
  const now = new Date('2026-07-11T05:00:00Z');

  it('returns null when no rule matches', () => {
    expect(resolveRule([], 'p1', now, TZ)).toBeNull();
    expect(resolveRule([rule({ active: false })], 'p1', now, TZ)).toBeNull();
  });

  it('prefers a product-specific rule over a depot-wide one', () => {
    const wide = rule({ id: 'wide', productId: null, priority: 100 });
    const specific = rule({ id: 'specific', productId: 'p1', priority: 0 });
    expect(resolveRule([wide, specific], 'p1', now, TZ)?.id).toBe('specific');
  });

  it('breaks ties by priority then newest', () => {
    const a = rule({ id: 'a', productId: 'p1', priority: 1, createdAt: new Date('2026-01-01T00:00:00Z') });
    const b = rule({ id: 'b', productId: 'p1', priority: 2, createdAt: new Date('2026-01-01T00:00:00Z') });
    const c = rule({ id: 'c', productId: 'p1', priority: 2, createdAt: new Date('2026-02-01T00:00:00Z') });
    expect(resolveRule([a, b, c], 'p1', now, TZ)?.id).toBe('c');
  });

  it('applies a depot-wide rule to any product', () => {
    const wide = rule({ id: 'wide', productId: null });
    expect(resolveRule([wide], 'anything', now, TZ)?.id).toBe('wide');
  });
});
