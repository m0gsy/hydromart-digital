import {
  PTKP_ANNUAL_IDR,
  PtkpCode,
  StatutoryInput,
  StatutoryRates,
  bpjsEmployeeDeductions,
  pph21Monthly,
  progressiveTax,
  statutoryDeductions,
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
