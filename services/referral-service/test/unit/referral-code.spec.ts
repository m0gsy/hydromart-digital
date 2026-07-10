import { generateReferralCode, normalizeCode } from '../../src/domain/referral-code';

describe('referral code', () => {
  it('generates an 8-character uppercase [A-Z0-9] code', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateReferralCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
    }
  });

  it('produces varying codes (not a constant)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateReferralCode()));
    // Collisions across 50 draws from 36^8 space are astronomically unlikely.
    expect(codes.size).toBeGreaterThan(1);
  });

  it('normalises a code by trimming and uppercasing', () => {
    expect(normalizeCode('  a1b2c3d4 ')).toBe('A1B2C3D4');
    expect(normalizeCode('hemat10')).toBe('HEMAT10');
    expect(normalizeCode('ALREADY')).toBe('ALREADY');
  });
});
