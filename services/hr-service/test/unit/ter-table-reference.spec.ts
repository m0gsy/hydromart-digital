import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PtkpCode,
  TerTable,
  assertTerTable,
  terCategoryFor,
  terRate,
} from '../../src/domain/statutory';

/**
 * Pins the transcribed PMK 168/2023 TER table that ships in `reference/`.
 *
 * The table is NOT a default. `pph21TerTableJson` still ships empty and the annualised
 * progressive method still runs until somebody loads this deliberately — see
 * `domain/statutory.ts`. What this file buys is the thing a JSON blob in a folder cannot
 * have on its own: proof that the shape is one `HrConfigService.pph21TerTable` will accept
 * rather than log-and-ignore, and a tripwire under the numbers themselves.
 *
 * The numbers were transcribed from two independent renderings of the regulation's appendix
 * that agree row for row (44/40/41 bands). They still want an accountant's signature before
 * they go anywhere near a payslip; a test cannot supply that, and does not pretend to.
 */
const RAW = readFileSync(
  join(__dirname, '..', '..', 'reference', 'pph21-ter-pmk-168-2023.json'),
  'utf8',
);

/** Exactly what `HrConfigService.pph21TerTable` does to the setting's string. */
function load(raw: string): TerTable {
  const json = JSON.parse(raw) as Record<string, { upToIdr: number | null; rate: number }[]>;
  return Object.fromEntries(
    Object.entries(json).map(([category, bands]) => [
      category,
      bands.map((b) => ({ upToIdr: b.upToIdr ?? Number.POSITIVE_INFINITY, rate: b.rate })),
    ]),
  ) as TerTable;
}

describe('PMK 168/2023 TER reference table', () => {
  const table = load(RAW);

  it('is one the config loader accepts rather than logs and ignores', () => {
    expect(assertTerTable(table)).toBeNull();
  });

  it('has the band count the regulation prints for each category', () => {
    expect(table.A).toHaveLength(44);
    expect(table.B).toHaveLength(40);
    expect(table.C).toHaveLength(41);
  });

  it('starts every category at nil and tops out at 34%', () => {
    for (const category of ['A', 'B', 'C'] as const) {
      const bands = table[category] ?? [];
      expect(bands[0].rate).toBe(0);
      expect(bands[bands.length - 1].rate).toBe(0.34);
    }
  });

  /**
   * A quarter of one percent has to be 0.0025, not 0.0024999999999999996. It is the smallest
   * non-zero rate in the table and the one a percent-to-fraction division is most likely to
   * land beside, and every band below it withholds nothing at all — so this row is where a
   * float artefact would first reach somebody's pay.
   */
  it('expresses fractional percentages exactly', () => {
    expect(table.A?.[1]).toEqual({ upToIdr: 5650000, rate: 0.0025 });
    expect(table.A?.[5]).toEqual({ upToIdr: 7500000, rate: 0.0125 });
    expect(table.C?.[7]).toEqual({ upToIdr: 11200000, rate: 0.0175 });
  });

  /**
   * The lookup and the category map, read end to end — a rate is only correct for the person
   * it is applied to, and PTKP status is what picks the column.
   */
  it.each<[PtkpCode, number, number]>([
    // Below its category's threshold: withholds nothing.
    ['TK0', 5_400_000, 0],
    ['K1', 6_200_000, 0],
    ['K3', 6_600_000, 0],
    // A married employee with three dependants is taxed less than a single one on the same
    // pay — the whole point of having three tables.
    ['TK0', 10_000_000, 0.02],
    ['K1', 10_000_000, 0.015],
    ['K3', 10_000_000, 0.015],
    // Top band, open-ended.
    ['TK0', 2_000_000_000, 0.34],
  ])('withholds %s on %d at the regulation rate', (ptkp, gross, rate) => {
    const bands = table[terCategoryFor(ptkp)] ?? [];
    expect(terRate(gross, bands)).toBe(rate);
  });
});
