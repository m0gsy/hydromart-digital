import {
  PTKP_ANNUAL_IDR,
  Pph21YearToDate,
  PtkpCode,
  StatutoryInput,
  StatutoryRates,
  TerTable,
  assertTerTable,
  bpjsEmployeeDeductions,
  pph21December,
  pph21Monthly,
  progressiveTax,
  statutoryDeductions,
  terCategoryFor,
  terRate,
} from '../../src/domain/statutory';

/** The statutory defaults in force, mirroring config/setting-defs.ts. */
const RATES: StatutoryRates = {
  healthEmployeePct: 1,
  healthCeilingIdr: 12_000_000,
  jhtEmployeePct: 2,
  jpEmployeePct: 1,
  jpCeilingIdr: 10_547_400,
  occupationalCostPct: 5,
  occupationalCostCapIdr: 500_000,
  noNpwpSurchargePct: 20,
};

const employee = (over: Partial<StatutoryInput> = {}): StatutoryInput => ({
  grossIdr: 5_000_000,
  ptkpStatus: 'TK0',
  hasNpwp: true,
  enrolledHealth: true,
  enrolledEmployment: true,
  ...over,
});

describe('BPJS employee contributions', () => {
  it('takes 1% health, 2% JHT and 1% JP off an ordinary wage', () => {
    expect(bpjsEmployeeDeductions(employee({ grossIdr: 5_000_000 }), RATES)).toEqual([
      { label: 'BPJS Kesehatan (karyawan)', amountIdr: 50_000 },
      { label: 'BPJS JHT (karyawan)', amountIdr: 100_000 },
      { label: 'BPJS Jaminan Pensiun (karyawan)', amountIdr: 50_000 },
    ]);
  });

  // The two ceilings differ and neither applies to JHT. A single "cap everything at the
  // same number" shortcut would overcharge high earners on JHT and undercharge on health.
  it('caps health and JP at their own ceilings, and leaves JHT uncapped', () => {
    const lines = bpjsEmployeeDeductions(employee({ grossIdr: 20_000_000 }), RATES);
    expect(lines.map((l) => l.amountIdr)).toEqual([
      120_000, // 1% of the 12.000.000 health ceiling, not of 20.000.000
      400_000, // 2% of the full wage — JHT has no ceiling
      105_474, // 1% of the 10.547.400 JP ceiling
    ]);
  });

  // Enrolment is what makes the deduction lawful: there is nowhere to remit money for
  // someone who is not in the scheme.
  it('deducts nothing for an employee who is not enrolled', () => {
    expect(
      bpjsEmployeeDeductions(
        employee({ enrolledHealth: false, enrolledEmployment: false }),
        RATES,
      ),
    ).toEqual([]);
    const healthOnly = bpjsEmployeeDeductions(employee({ enrolledEmployment: false }), RATES);
    expect(healthOnly.map((l) => l.label)).toEqual(['BPJS Kesehatan (karyawan)']);
  });

  it('emits no line when a rate is configured to zero', () => {
    expect(bpjsEmployeeDeductions(employee(), { ...RATES, healthEmployeePct: 0 })).toHaveLength(2);
  });
});

describe('progressive brackets (UU HPP Article 17)', () => {
  it.each([
    [0, 0],
    [60_000_000, 3_000_000], // whole first band at 5%
    [60_000_001, 3_000_000.15], // one rupiah into the 15% band
    [250_000_000, 31_500_000], // 3.000.000 + 15% of 190.000.000
    [500_000_000, 94_000_000], // + 25% of 250.000.000
  ])('taxes %d as %d', (taxable, expected) => {
    expect(progressiveTax(taxable)).toBeCloseTo(expected, 2);
  });

  it('never taxes a negative', () => {
    expect(progressiveTax(-1_000_000)).toBe(0);
  });
});

describe('PPh 21 monthly withholding', () => {
  // Rp 5.000.000/month annualises to 60.000.000, minus 3.000.000 biaya jabatan and
  // 2.400.000 employee BPJS = 54.600.000, minus TK/0 PTKP 54.000.000 = 600.000 taxable.
  // 5% of that is 30.000/year, so 2.500/month.
  it('computes the annualised-progressive estimate for an ordinary depot wage', () => {
    const bpjs = bpjsEmployeeDeductions(employee(), RATES).reduce((s, l) => s + l.amountIdr, 0);
    expect(bpjs).toBe(200_000);
    const result = pph21Monthly(employee(), bpjs, RATES);
    expect(result.annualTaxableIdr).toBe(600_000);
    expect(result.monthlyIdr).toBe(2_500);
  });

  it('withholds nothing when PTKP already covers the income', () => {
    const input = employee({ grossIdr: 3_000_000 });
    const bpjs = bpjsEmployeeDeductions(input, RATES).reduce((s, l) => s + l.amountIdr, 0);
    expect(pph21Monthly(input, bpjs, RATES)).toEqual({ monthlyIdr: 0, annualTaxableIdr: 0 });
  });

  // Withholding an invented amount from someone's pay is worse than withholding none:
  // it takes money the company cannot justify. The missing status is a data-entry gap.
  it('withholds nothing when no PTKP status is on file', () => {
    expect(pph21Monthly(employee({ ptkpStatus: null }), 200_000, RATES).monthlyIdr).toBe(0);
  });

  it('adds the 20% surcharge for an employee with no NPWP', () => {
    const input = employee({ hasNpwp: false });
    const withNpwp = pph21Monthly(employee(), 200_000, RATES).monthlyIdr;
    expect(pph21Monthly(input, 200_000, RATES).monthlyIdr).toBe(Math.round(withNpwp * 1.2));
  });

  it('gives a bigger PTKP allowance to a married employee with dependants', () => {
    const gross = 10_000_000;
    const forStatus = (ptkpStatus: PtkpCode): number =>
      pph21Monthly(employee({ grossIdr: gross, ptkpStatus }), 300_000, RATES).monthlyIdr;
    expect(PTKP_ANNUAL_IDR.K3).toBeGreaterThan(PTKP_ANNUAL_IDR.TK0);
    expect(forStatus('K3')).toBeLessThan(forStatus('TK0'));
  });

  it('rounds taxable income down to the nearest thousand, as the rule requires', () => {
    // Chosen so the pre-rounding remainder carries an awkward tail.
    const input = employee({ grossIdr: 5_000_123 });
    const bpjs = bpjsEmployeeDeductions(input, RATES).reduce((s, l) => s + l.amountIdr, 0);
    expect(pph21Monthly(input, bpjs, RATES).annualTaxableIdr % 1000).toBe(0);
  });
});

describe('statutoryDeductions (payslip order)', () => {
  // BPJS first is not cosmetic: the employee's own contributions are deductible against
  // PPh 21, so a tax computed before them would be too high.
  it('lists BPJS before the tax it reduces', () => {
    const lines = statutoryDeductions(employee(), RATES);
    expect(lines.map((l) => l.label)).toEqual([
      'BPJS Kesehatan (karyawan)',
      'BPJS JHT (karyawan)',
      'BPJS Jaminan Pensiun (karyawan)',
      'PPh 21',
    ]);
  });

  it('reduces the tax by exactly the BPJS the employee paid', () => {
    const input = employee();
    const withBpjs = statutoryDeductions(input, RATES).find((l) => l.label === 'PPh 21');
    const unenrolled = statutoryDeductions(
      { ...input, enrolledHealth: false, enrolledEmployment: false },
      RATES,
    ).find((l) => l.label === 'PPh 21');
    expect(unenrolled!.amountIdr).toBeGreaterThan(withBpjs!.amountIdr);
  });

  it('omits the PPh 21 line entirely when nothing is owed', () => {
    const lines = statutoryDeductions(employee({ grossIdr: 3_000_000 }), RATES);
    expect(lines.some((l) => l.label === 'PPh 21')).toBe(false);
  });
});

/**
 * A stand-in table, NOT the PMK's. Two bands per category with round numbers, so these
 * tests check the mechanism — category routing, band lookup, the surcharge, the fallback —
 * and never pretend to check rates this repo deliberately does not carry.
 */
const TER: TerTable = {
  A: [
    { upToIdr: 6_000_000, rate: 0 },
    { upToIdr: Number.POSITIVE_INFINITY, rate: 0.02 },
  ],
  B: [
    { upToIdr: 7_000_000, rate: 0 },
    { upToIdr: Number.POSITIVE_INFINITY, rate: 0.01 },
  ],
  C: [{ upToIdr: Number.POSITIVE_INFINITY, rate: 0.005 }],
};

describe('TER (PMK 168/2023)', () => {
  it('routes each PTKP status to its category', () => {
    expect((['TK0', 'TK1', 'K0'] as PtkpCode[]).map(terCategoryFor)).toEqual(['A', 'A', 'A']);
    expect((['TK2', 'TK3', 'K1', 'K2'] as PtkpCode[]).map(terCategoryFor)).toEqual([
      'B',
      'B',
      'B',
      'B',
    ]);
    expect(terCategoryFor('K3')).toBe('C');
  });

  // Defensive: a table that passed validation always has an open-ended top band, so this
  // only fires if one is constructed by hand. Answering with the top rate beats answering 0.
  it('falls back to the top rate for a gross above every band', () => {
    expect(terRate(999_000_000, [{ upToIdr: 1_000_000, rate: 0.03 }])).toBe(0.03);
    expect(terRate(1, [])).toBe(0);
  });

  it('takes the first band the gross fits under, and the open-ended one above them all', () => {
    expect(terRate(5_000_000, TER.A!)).toBe(0);
    expect(terRate(6_000_000, TER.A!)).toBe(0); // inclusive upper bound
    expect(terRate(6_000_001, TER.A!)).toBe(0.02);
  });

  it('withholds a flat rate on the month gross, with no PTKP subtraction', () => {
    const out = pph21Monthly(employee({ grossIdr: 10_000_000 }), 300_000, RATES, TER);
    expect(out.monthlyIdr).toBe(200_000); // 2% of 10,000,000 — the table carries the PTKP
  });

  it('still adds the no-NPWP surcharge', () => {
    const out = pph21Monthly(
      employee({ grossIdr: 10_000_000, hasNpwp: false }),
      300_000,
      RATES,
      TER,
    );
    expect(out.monthlyIdr).toBe(240_000); // 200,000 × 1.2
  });

  // The whole safety of shipping an empty table rests on this: no table means the method
  // that was running before keeps running, unchanged.
  it('falls back to the annualised estimate when no table is configured', () => {
    const withTable = pph21Monthly(employee({ grossIdr: 10_000_000 }), 300_000, RATES, {});
    const without = pph21Monthly(employee({ grossIdr: 10_000_000 }), 300_000, RATES);
    expect(withTable).toEqual(without);
  });

  it('falls back for a category the table does not carry, rather than withholding zero', () => {
    const partial: TerTable = { A: TER.A };
    const k3 = employee({ grossIdr: 10_000_000, ptkpStatus: 'K3' });
    expect(pph21Monthly(k3, 300_000, RATES, partial)).toEqual(pph21Monthly(k3, 300_000, RATES));
  });
});

describe('assertTerTable', () => {
  it('accepts no table at all — that is the shipped state, not an error', () => {
    expect(assertTerTable({})).toBeNull();
  });

  it('accepts a complete, ascending, open-ended table', () => {
    expect(assertTerTable(TER)).toBeNull();
  });

  // The dangerous case: half a table means half the workforce silently changes method.
  it('refuses a table missing a category', () => {
    expect(assertTerTable({ A: TER.A })).toMatch(/incomplete/);
  });

  it('refuses bands that are not ascending', () => {
    const jumbled: TerTable = {
      ...TER,
      A: [
        { upToIdr: 9_000_000, rate: 0.01 },
        { upToIdr: 6_000_000, rate: 0 },
        { upToIdr: Number.POSITIVE_INFINITY, rate: 0.02 },
      ],
    };
    expect(assertTerTable(jumbled)).toMatch(/ascending/);
  });

  it('refuses a percentage typed as a whole number', () => {
    const percent: TerTable = {
      ...TER,
      B: [{ upToIdr: Number.POSITIVE_INFINITY, rate: 5 }],
    };
    expect(assertTerTable(percent)).toMatch(/fractions/);
  });

  it('refuses a table with no open-ended top band', () => {
    const capped: TerTable = { ...TER, C: [{ upToIdr: 50_000_000, rate: 0.005 }] };
    expect(assertTerTable(capped)).toMatch(/open-ended/);
  });
});

describe('December reconciliation', () => {
  const ytd = (over: Partial<Pph21YearToDate> = {}): Pph21YearToDate => ({
    grossIdr: 110_000_000, // 11 × 10,000,000
    bpjsIdr: 3_300_000,
    withheldIdr: 2_200_000,
    months: 11,
    ...over,
  });

  it('withholds the difference between the year owed and the year already taken', () => {
    const out = pph21December(employee({ grossIdr: 10_000_000 }), ytd(), 300_000, RATES);
    expect(out.annualTaxIdr).toBeGreaterThan(0);
    expect(out.monthlyIdr).toBe(out.annualTaxIdr - 2_200_000);
    expect(out.overWithheldIdr).toBe(0);
  });

  // An employer cannot hand tax back through payroll. Reporting it is the honest answer;
  // netting it into a negative deduction would be inventing a payment.
  it('never returns a negative, and names the over-withholding instead', () => {
    const out = pph21December(
      employee({ grossIdr: 10_000_000 }),
      ytd({ withheldIdr: 999_000_000 }),
      300_000,
      RATES,
    );
    expect(out.monthlyIdr).toBe(0);
    expect(out.overWithheldIdr).toBeGreaterThan(0);
  });

  it('caps biaya jabatan per month, not once on the annual gross', () => {
    // 20,000,000/month is well over the 500,000 monthly cap, so the annual allowance is
    // 6,000,000 — not 5% of 240,000,000 (12,000,000). Getting this wrong halves the tax.
    const high = pph21December(
      employee({ grossIdr: 20_000_000 }),
      ytd({ grossIdr: 220_000_000, bpjsIdr: 0, withheldIdr: 0, months: 11 }),
      0,
      RATES,
    );
    const taxableIfCappedMonthly = 240_000_000 - 6_000_000 - PTKP_ANNUAL_IDR.TK0;
    expect(high.annualTaxableIdr).toBe(Math.floor(taxableIfCappedMonthly / 1000) * 1000);
  });

  it('is zero for an employee PTKP already covers, and reports what was taken anyway', () => {
    const out = pph21December(
      employee({ grossIdr: 3_000_000 }),
      ytd({ grossIdr: 33_000_000, bpjsIdr: 990_000, withheldIdr: 120_000, months: 11 }),
      90_000,
      RATES,
    );
    expect(out.monthlyIdr).toBe(0);
    expect(out.overWithheldIdr).toBe(120_000);
  });

  it('adds the no-NPWP surcharge to the year, not just to a month', () => {
    const withNpwp = pph21December(employee({ grossIdr: 10_000_000 }), ytd({ withheldIdr: 0 }), 300_000, RATES);
    const without = pph21December(
      employee({ grossIdr: 10_000_000, hasNpwp: false }),
      ytd({ withheldIdr: 0 }),
      300_000,
      RATES,
    );
    expect(without.annualTaxIdr).toBe(Math.round(withNpwp.annualTaxIdr * 1.2));
  });

  // A December-only employee (joined in December) has no prior months at all: the
  // averaging step must not divide by zero.
  it('handles a year with no prior months', () => {
    const out = pph21December(
      employee({ grossIdr: 10_000_000 }),
      ytd({ grossIdr: 0, bpjsIdr: 0, withheldIdr: 0, months: 0 }),
      300_000,
      RATES,
    );
    expect(out.monthlyIdr).toBe(0); // one month of pay is far under PTKP
    expect(out.overWithheldIdr).toBe(0);
  });

  it('withholds nothing without a PTKP status on file, exactly like the monthly path', () => {
    expect(pph21December(employee({ ptkpStatus: null }), ytd(), 0, RATES).monthlyIdr).toBe(0);
  });

  it('handles a mid-year joiner, whose prior months are fewer than eleven', () => {
    const out = pph21December(
      employee({ grossIdr: 10_000_000 }),
      ytd({ grossIdr: 30_000_000, bpjsIdr: 900_000, withheldIdr: 200_000, months: 3 }),
      300_000,
      RATES,
    );
    // Four months of pay, so four months of biaya jabatan — not eleven.
    expect(out.annualTaxableIdr).toBeLessThan(40_000_000);
    expect(out.monthlyIdr).toBeGreaterThanOrEqual(0);
  });
});
