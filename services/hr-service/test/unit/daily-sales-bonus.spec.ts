import { bonusForDay, parseTiers } from '../../src/domain/daily-sales-bonus';

// Depot SOP ladder from the operating rules: 120 gal → Rp15.000 … 300 gal → Rp150.000.
const SOP = '120:15000,150:20000,180:30000,200:50000,225:75000,250:100000,300:150000';

describe('parseTiers', () => {
  it('parses the SOP ladder in order', () => {
    expect(parseTiers(SOP)).toEqual([
      { gallons: 120, amount: 15000 },
      { gallons: 150, amount: 20000 },
      { gallons: 180, amount: 30000 },
      { gallons: 200, amount: 50000 },
      { gallons: 225, amount: 75000 },
      { gallons: 250, amount: 100000 },
      { gallons: 300, amount: 150000 },
    ]);
  });

  it('sorts ascending however the CSV was typed', () => {
    expect(parseTiers('200:50000,120:15000')).toEqual([
      { gallons: 120, amount: 15000 },
      { gallons: 200, amount: 50000 },
    ]);
  });

  it('treats an empty string as no ladder at all (feature off)', () => {
    expect(parseTiers('')).toEqual([]);
    expect(parseTiers('   ')).toEqual([]);
    expect(parseTiers(',,')).toEqual([]);
  });

  it('drops malformed entries rather than inventing a tier', () => {
    // ':15000' — Number('') is 0, so a missing threshold must not become "0 gallons pays".
    // '120:' and '120' — a threshold with no reward. '-5' / '1.5' — not a whole gallon count.
    expect(parseTiers(':15000,120:,120,-5:1000,1.5:1000,abc:1000,120:abc')).toEqual([]);
  });

  it('keeps a zero-gallon or zero-rupiah tier — both are legitimate settings', () => {
    expect(parseTiers('0:5000,120:0')).toEqual([
      { gallons: 0, amount: 5000 },
      { gallons: 120, amount: 0 },
    ]);
  });
});

describe('bonusForDay', () => {
  const tiers = parseTiers(SOP);

  it('pays nothing below the first threshold', () => {
    expect(bonusForDay(tiers, 0)).toBe(0);
    expect(bonusForDay(tiers, 119)).toBe(0);
  });

  it('pays the tier exactly at its threshold', () => {
    expect(bonusForDay(tiers, 120)).toBe(15000);
    expect(bonusForDay(tiers, 300)).toBe(150000);
  });

  it('pays the highest tier reached, not the first', () => {
    expect(bonusForDay(tiers, 299)).toBe(100000); // 250 tier, not 300
    expect(bonusForDay(tiers, 301)).toBe(150000); // capped at the top tier
  });

  it('pays nothing on an empty ladder', () => {
    expect(bonusForDay([], 999)).toBe(0);
  });

  it('pays nothing when the gallon figure is unknown — null must never pay', () => {
    expect(bonusForDay(tiers, null)).toBe(0);
  });
});
