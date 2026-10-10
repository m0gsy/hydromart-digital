// Splitting one payslip across the depots an employee worked at. Pure, integer rupiah.
//
// The slip total never changes; this only says which depot owes which part of it. Every
// figure is divided by largest-remainder over integer weights, so the parts add back to the
// total EXACTLY - no depot gets a rupiah invented for it and none loses one - and the same
// inputs always give the same split (ties go to the lower depotId).
//
// Net is NOT divided on its own: dividing gross and net separately can leave a depot with a
// negative deduction. Gross, bonus, the deduction actually taken and the floor shortfall are
// divided, and a depot's net is derived: net_d = gross_d + bonus_d - deduction_d.

export interface DepotWeight {
  depotId: string;
  weight: number;
}

export interface AllocationInput {
  /** Receives everything when a weight vector is empty or sums to zero. */
  homeDepotId: string;
  gross: number;
  totalBonus: number;
  /** Everything assessed, as printed on the slip (can exceed what could be taken). */
  totalDeduction: number;
  /** Stored net, after the D4 floor. */
  net: number;
  /** Calendar days (MONTHLY) or present days (DAILY) per depot. Also weights deductions. */
  grossWeights: readonly DepotWeight[];
  /** Per-depot bonus weights (galon / sales earned where the day was worked). Defaults to grossWeights. */
  bonusWeights?: readonly DepotWeight[];
  /**
   * Bonus already known to belong to a depot (the daily gallon bonus earned on a day worked
   * THERE). Taken off the top; only the rest of `totalBonus` is split by `bonusWeights`.
   */
  bonusDirect?: readonly { depotId: string; amount: number }[];
}

export interface DepotShare {
  depotId: string;
  days: number;
  gross: number;
  bonus: number;
  /** The part of the assessed deductions actually taken from pay. */
  deduction: number;
  /** The assessed excess the D4 floor made uncollectable. Informational: not part of net. */
  shortfall: number;
  net: number;
}

// Ids are unique by the time they are sorted, so equality cannot occur.
function assertWhole(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} harus bilangan bulat >= 0 (diterima ${value})`);
  }
}

/**
 * Largest-remainder apportionment of `total` over integer `weights`. Exact in BigInt, so a
 * large amount times an odd weight cannot be rounded by a double. Leftover units go to the
 * biggest fractional remainders, ties to the lower index (callers sort by depotId first).
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  assertWhole('total', total);
  weights.forEach((w, i) => assertWhole(`weights[${i}]`, w));
  const sumW = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (sumW === 0n) throw new RangeError('Jumlah bobot nol: tidak ada yang bisa dibagi');
  const t = BigInt(total);
  const parts = weights.map((w, i) => ({
    i,
    floor: (t * BigInt(w)) / sumW,
    rem: (t * BigInt(w)) % sumW,
  }));
  let left = t - parts.reduce((a, p) => a + p.floor, 0n);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const out = parts.map((p) => p.floor);
  for (const p of order) {
    if (left === 0n) break;
    out[p.i] += 1n;
    left -= 1n;
  }
  return out.map(Number);
}

/** Merge duplicate depots and drop zero weights; the result is sorted by depotId. */
function normalise(weights: readonly DepotWeight[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const { depotId, weight } of weights) {
    assertWhole(`bobot ${depotId}`, weight);
    merged.set(depotId, (merged.get(depotId) ?? 0) + weight);
  }
  for (const [depotId, w] of merged) if (w === 0) merged.delete(depotId);
  return new Map([...merged].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Divide `total` over `weights` onto depot ids; all of it to `fallback` if no weight. */
function split(total: number, weights: Map<string, number>, fallback: string): Map<string, number> {
  if (weights.size === 0) return new Map([[fallback, total]]);
  const ids = [...weights.keys()];
  const parts = largestRemainder(total, [...weights.values()]);
  return new Map(ids.map((id, i) => [id, parts[i]]));
}

/**
 * Divide `total` by `weights`, but never give a depot more than `caps` allows. Whatever a
 * capped depot cannot absorb spills to the others in proportion to their spare room.
 * Callers guarantee total <= sum(caps).
 */
function splitCapped(
  total: number,
  weights: Map<string, number>,
  caps: Map<string, number>,
  fallback: string,
): Map<string, number> {
  const first = split(total, weights, fallback);
  const out = new Map<string, number>();
  let overflow = 0;
  for (const [id, amount] of first) {
    const cap = caps.get(id) ?? 0;
    out.set(id, Math.min(amount, cap));
    overflow += Math.max(0, amount - cap);
  }
  if (overflow === 0) return out;
  const spare = new Map<string, number>();
  for (const [id, cap] of [...caps].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const room = cap - (out.get(id) ?? 0);
    if (room > 0) spare.set(id, room);
  }
  for (const [id, extra] of split(overflow, spare, fallback)) {
    out.set(id, (out.get(id) ?? 0) + extra);
  }
  return out;
}

export function allocatePayroll(input: AllocationInput): DepotShare[] {
  const { homeDepotId, gross, totalBonus, totalDeduction, net } = input;
  assertWhole('gross', gross);
  assertWhole('totalBonus', totalBonus);
  assertWhole('totalDeduction', totalDeduction);
  assertWhole('net', net);
  const taken = gross + totalBonus - net;
  if (taken < 0) throw new RangeError('Net melebihi gross + bonus: slip tidak mungkin');
  if (taken > totalDeduction) {
    throw new RangeError('Potongan yang terambil melebihi potongan yang dinilai: slip tidak mungkin');
  }
  const shortfall = totalDeduction - taken;

  const wGross = normalise(input.grossWeights);
  const wBonus = input.bonusWeights ? normalise(input.bonusWeights) : wGross;

  const grossBy = split(gross, wGross, homeDepotId);
  const bonusBy = new Map<string, number>();
  let direct = 0;
  for (const { depotId, amount } of input.bonusDirect ?? []) {
    assertWhole(`bonus ${depotId}`, amount);
    bonusBy.set(depotId, (bonusBy.get(depotId) ?? 0) + amount);
    direct += amount;
  }
  if (direct > totalBonus) throw new RangeError('Bonus per depot melebihi total bonus');
  for (const [id, part] of split(totalBonus - direct, wBonus, homeDepotId)) {
    bonusBy.set(id, (bonusBy.get(id) ?? 0) + part);
  }
  const room = new Map<string, number>();
  for (const id of new Set([...grossBy.keys(), ...bonusBy.keys()])) {
    room.set(id, (grossBy.get(id) ?? 0) + (bonusBy.get(id) ?? 0));
  }
  const deductionBy = splitCapped(taken, wGross, room, homeDepotId);
  const shortfallBy = split(shortfall, wGross, homeDepotId);

  const ids = new Set<string>([...wGross.keys(), ...wBonus.keys(), ...room.keys(), ...shortfallBy.keys()]);
  return [...ids]
    .sort((a, b) => (a < b ? -1 : 1))
    .map((depotId) => {
      const g = grossBy.get(depotId) ?? 0;
      const b = bonusBy.get(depotId) ?? 0;
      const d = deductionBy.get(depotId) ?? 0;
      return {
        depotId,
        days: wGross.get(depotId) ?? 0,
        gross: g,
        bonus: b,
        deduction: d,
        shortfall: shortfallBy.get(depotId) ?? 0,
        net: g + b - d,
      };
    });
}

/** One depot's part as HQ states it when it corrects a split by hand. */
export interface ShareCorrection {
  depotId: string;
  days: number;
  gross: number;
  bonus: number;
  deduction: number;
  shortfall: number;
}

/**
 * Whether a hand-made split is a faithful division of the slip: whole non-negative numbers,
 * one row per depot, and each column adding up to exactly what the slip says. Net is not
 * asked for - it is always gross + bonus - deduction, so a person cannot state one that
 * disagrees with its parts. Returns every problem, empty when the split may be stored.
 */
export function reallocationProblems(
  slip: { gross: number; totalBonus: number; totalDeduction: number },
  shares: readonly ShareCorrection[],
): string[] {
  const out: string[] = [];
  if (shares.length === 0) return ['Pembagian depot tidak boleh kosong.'];
  const ids = new Set(shares.map((s) => s.depotId));
  if (ids.size !== shares.length) out.push('Satu depot hanya boleh muncul sekali.');
  const cols = ['days', 'gross', 'bonus', 'deduction', 'shortfall'] as const;
  for (const s of shares) {
    for (const c of cols) {
      if (!Number.isInteger(s[c]) || s[c] < 0) {
        out.push(`Nilai ${c} untuk depot ${s.depotId} harus bilangan bulat tidak negatif.`);
      }
    }
  }
  const sum = (c: (typeof cols)[number]) => shares.reduce((t, s) => t + s[c], 0);
  const expect: [string, number, number][] = [
    ['gross', sum('gross'), slip.gross],
    ['bonus', sum('bonus'), slip.totalBonus],
    ['potongan', sum('deduction'), slip.totalDeduction],
  ];
  for (const [label, got, want] of expect) {
    if (got !== want) out.push(`Jumlah ${label} ${got} tidak sama dengan slip (${want}).`);
  }
  return out;
}
