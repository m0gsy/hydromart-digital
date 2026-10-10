import {
  allocatePayroll,
  largestRemainder,
  type AllocationInput,
} from '../../src/domain/payroll-allocation';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function base(over: Partial<AllocationInput> = {}): AllocationInput {
  return {
    homeDepotId: A,
    gross: 3_100_000,
    totalBonus: 0,
    totalDeduction: 0,
    net: 3_100_000,
    grossWeights: [
      { depotId: A, weight: 21 },
      { depotId: B, weight: 10 },
    ],
    ...over,
  };
}

describe('largestRemainder', () => {
  it('hands out the whole total, floor first, leftovers by biggest remainder', () => {
    expect(largestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(100, [1, 2, 3])).toEqual([17, 33, 50]);
  });

  it('breaks an exact remainder tie by position (callers sort by depotId first)', () => {
    expect(largestRemainder(1, [1, 1])).toEqual([1, 0]);
  });

  it('is exact on amounts a double would round (big total x odd weights)', () => {
    const r = largestRemainder(9_007_199_254_740_991, [3, 7, 11]);
    expect(sum(r)).toBe(9_007_199_254_740_991);
  });

  it('rejects zero-sum weights, negatives and fractions', () => {
    expect(() => largestRemainder(5, [0, 0])).toThrow(RangeError);
    expect(() => largestRemainder(5, [-1, 2])).toThrow(RangeError);
    expect(() => largestRemainder(5, [1.5, 2])).toThrow(RangeError);
    expect(() => largestRemainder(-5, [1])).toThrow(RangeError);
  });
});

describe('allocatePayroll', () => {
  it('splits an exact month 21:10 with nothing left over', () => {
    expect(allocatePayroll(base())).toEqual([
      { depotId: A, days: 21, gross: 2_100_000, bonus: 0, deduction: 0, shortfall: 0, net: 2_100_000 },
      { depotId: B, days: 10, gross: 1_000_000, bonus: 0, deduction: 0, shortfall: 0, net: 1_000_000 },
    ]);
  });

  it('keeps the total when the amount does not divide (odd rupiah)', () => {
    const r = allocatePayroll(base({ gross: 1_000_001, net: 1_000_001 }));
    expect(sum(r.map((s) => s.gross))).toBe(1_000_001);
    expect(sum(r.map((s) => s.net))).toBe(1_000_001);
  });

  it('gives a one-rupiah tie to the lower depotId, whatever order the weights arrive in', () => {
    const forward = allocatePayroll(
      base({ gross: 1, net: 1, grossWeights: [{ depotId: A, weight: 1 }, { depotId: B, weight: 1 }] }),
    );
    const reversed = allocatePayroll(
      base({ gross: 1, net: 1, grossWeights: [{ depotId: B, weight: 1 }, { depotId: A, weight: 1 }] }),
    );
    expect(forward).toEqual(reversed);
    expect(forward.find((s) => s.depotId === A)!.gross).toBe(1);
    expect(forward.find((s) => s.depotId === B)!.gross).toBe(0);
  });

  it('puts everything on the home depot when no weight exists (no divide by zero)', () => {
    const r = allocatePayroll(base({ homeDepotId: B, grossWeights: [] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ depotId: B, days: 0, gross: 3_100_000, net: 3_100_000 });
  });

  it('merges duplicate depot rows instead of splitting a depot against itself', () => {
    const r = allocatePayroll(
      base({
        grossWeights: [
          { depotId: A, weight: 5 },
          { depotId: A, weight: 16 },
          { depotId: B, weight: 10 },
        ],
      }),
    );
    expect(r.map((s) => s.days)).toEqual([21, 10]);
  });

  it('allocates deductions as taken: net_d = gross_d + bonus_d - deduction_d', () => {
    const r = allocatePayroll(base({ totalDeduction: 310_000, net: 2_790_000 }));
    for (const s of r) expect(s.net).toBe(s.gross + s.bonus - s.deduction);
    expect(sum(r.map((s) => s.deduction))).toBe(310_000);
    expect(sum(r.map((s) => s.net))).toBe(2_790_000);
  });

  it('never yields a negative per-depot deduction (the case of splitting net on its own)', () => {
    // Splitting gross and net independently over 1:1:1 gives gross 34/33/33 and net 34/33/32
    // for a single rupiah of deduction: one depot ends at -1.
    const w = [A, B, C].map((depotId) => ({ depotId, weight: 1 }));
    const r = allocatePayroll(base({ gross: 100, net: 99, totalDeduction: 1, grossWeights: w }));
    for (const s of r) {
      expect(s.deduction).toBeGreaterThanOrEqual(0);
      expect(s.net).toBeGreaterThanOrEqual(0);
    }
    expect(sum(r.map((s) => s.deduction))).toBe(1);
  });

  it('when the D4 floor bites, the unpaid excess is shortfall and net stays 0 everywhere', () => {
    const r = allocatePayroll(base({ gross: 1_000_000, net: 0, totalDeduction: 1_500_000 }));
    expect(sum(r.map((s) => s.net))).toBe(0);
    expect(sum(r.map((s) => s.deduction))).toBe(1_000_000);
    expect(sum(r.map((s) => s.shortfall))).toBe(500_000);
    expect(sum(r.map((s) => s.deduction + s.shortfall))).toBe(1_500_000);
    for (const s of r) expect(s.net).toBe(0);
  });

  it('bonus uses its own weights and lands only where it was earned', () => {
    const r = allocatePayroll(
      base({ totalBonus: 90_000, net: 3_190_000, bonusWeights: [{ depotId: B, weight: 3 }] }),
    );
    expect(r.find((s) => s.depotId === A)!.bonus).toBe(0);
    expect(r.find((s) => s.depotId === B)!.bonus).toBe(90_000);
    expect(sum(r.map((s) => s.net))).toBe(3_190_000);
  });

  it('a deduction cannot push a depot below zero when its pay is mostly elsewhere', () => {
    // All salary at A, all bonus at B; deductions weigh by salary days (A) but A can only
    // absorb 100 - the rest must spill to B, not turn A's net negative.
    const r = allocatePayroll({
      homeDepotId: A,
      gross: 100,
      totalBonus: 50,
      totalDeduction: 150,
      net: 0,
      grossWeights: [{ depotId: A, weight: 1 }],
      bonusWeights: [{ depotId: B, weight: 1 }],
    });
    expect(r.find((s) => s.depotId === A)).toMatchObject({ gross: 100, deduction: 100, net: 0 });
    expect(r.find((s) => s.depotId === B)).toMatchObject({ bonus: 50, deduction: 50, net: 0 });
  });

  it('takes bonus already known to belong to a depot off the top; only the rest follows the weights', () => {
    const r = allocatePayroll(
      base({
        totalBonus: 100,
        net: 3_100_100,
        bonusDirect: [{ depotId: B, amount: 60 }],
      }),
    );
    // 40 left over splits 21:10 -> 27/13 (largest remainder), then B gets its 60 on top.
    const a = r.find((s) => s.depotId === A)!;
    const b = r.find((s) => s.depotId === B)!;
    expect(a.bonus + b.bonus).toBe(100);
    expect(b.bonus).toBeGreaterThanOrEqual(60);
    expect(a.bonus).toBeLessThan(b.bonus + 40);
  });

  it('refuses direct bonus that exceeds the total bonus', () => {
    expect(() =>
      allocatePayroll(base({ totalBonus: 10, net: 3_100_010, bonusDirect: [{ depotId: A, amount: 11 }] })),
    ).toThrow(RangeError);
  });

  it('refuses inputs that no real payslip can produce', () => {
    expect(() => allocatePayroll(base({ gross: -1 }))).toThrow(RangeError);
    expect(() => allocatePayroll(base({ gross: 10.5 }))).toThrow(RangeError);
    expect(() => allocatePayroll(base({ net: 4_000_000 }))).toThrow(RangeError); // net > gross + bonus
    expect(() => allocatePayroll(base({ totalDeduction: 0, net: 3_000_000 }))).toThrow(RangeError); // taken > assessed
    expect(() => allocatePayroll(base({ grossWeights: [{ depotId: A, weight: -2 }] }))).toThrow(
      RangeError,
    );
  });
});

describe('allocatePayroll - randomised invariants (seeded)', () => {
  // mulberry32: tiny deterministic PRNG so a failure reproduces from the seed alone.
  function rng(seed: number) {
    let t = seed;
    return () => {
      t = (t + 0x6d2b79f5) | 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const int = (r: () => number, max: number) => Math.floor(r() * (max + 1));
  const DEPOTS = [A, B, C, D];

  function weights(r: () => number): { depotId: string; weight: number }[] {
    return DEPOTS.filter(() => r() < 0.6).map((depotId) => ({ depotId, weight: int(r, 31) }));
  }

  it('holds on 5,000 random payslips', () => {
    const r = rng(20261009);
    const failures: string[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const gross = int(r, 20_000_000);
      const totalBonus = r() < 0.5 ? 0 : int(r, 3_000_000);
      const cap = gross + totalBonus;
      // Half the cases assess more than can be paid (D4 floor), half do not.
      const taken = int(r, cap);
      const totalDeduction = r() < 0.5 ? taken : taken + int(r, 2_000_000);
      const input: AllocationInput = {
        homeDepotId: DEPOTS[int(r, 3)],
        gross,
        totalBonus,
        totalDeduction,
        net: cap - taken,
        grossWeights: weights(r),
        bonusWeights: r() < 0.5 ? weights(r) : undefined,
      };
      const out = allocatePayroll(input);
      const bad: string[] = [];
      if (sum(out.map((s) => s.gross)) !== gross) bad.push('gross');
      if (sum(out.map((s) => s.bonus)) !== totalBonus) bad.push('bonus');
      if (sum(out.map((s) => s.net)) !== input.net) bad.push('net');
      if (sum(out.map((s) => s.deduction + s.shortfall)) !== totalDeduction) bad.push('deduction');
      for (const s of out) {
        if (Math.min(s.gross, s.bonus, s.deduction, s.shortfall, s.net, s.days) < 0) bad.push('negative');
        if (s.net !== s.gross + s.bonus - s.deduction) bad.push('net-formula');
      }
      // Deterministic, and independent of the order the caller listed weights in.
      const reordered = allocatePayroll({
        ...input,
        grossWeights: [...input.grossWeights].reverse(),
        bonusWeights: input.bonusWeights ? [...input.bonusWeights].reverse() : undefined,
      });
      if (JSON.stringify(reordered) !== JSON.stringify(out)) bad.push('order');
      if (JSON.stringify(allocatePayroll(input)) !== JSON.stringify(out)) bad.push('repeat');
      if (bad.length > 0) failures.push(`case ${i} [${bad.join(',')}] ${JSON.stringify(input)}`);
    }
    expect(failures.slice(0, 3)).toEqual([]);
  });
});
