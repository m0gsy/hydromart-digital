import { netProfit, type NetProfitTerms } from './net-profit';

const month: NetProfitTerms = {
  revenueIdr: 10_000_000,
  cogsIdr: 4_000_000,
  payrollIdr: 3_000_000,
  courierCommissionIdr: 500_000,
  expenseClaimIdr: 200_000,
  refundIdr: 100_000,
};

describe('netProfit', () => {
  it('is revenue minus goods, wages, courier commission, expense claims and refunds', () => {
    expect(netProfit(month)).toBe(2_200_000);
  });

  it('goes negative when costs exceed revenue', () => {
    expect(netProfit({ ...month, revenueIdr: 1_000_000 })).toBe(-6_800_000);
  });

  it.each(Object.keys(month) as (keyof NetProfitTerms)[])(
    'is null when %s could not be read, never a partial subtraction',
    (term) => {
      expect(netProfit({ ...month, [term]: null })).toBeNull();
    },
  );

  it('treats a term that is not a finite number as unread, so it never answers NaN', () => {
    expect(netProfit({ ...month, refundIdr: Number.NaN })).toBeNull();
    expect(netProfit({ ...month, revenueIdr: undefined as unknown as number })).toBeNull();
    expect(netProfit({ ...month, cogsIdr: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('reads a zero cost as zero, not as unknown', () => {
    expect(
      netProfit({
        revenueIdr: 51_000,
        cogsIdr: 0,
        payrollIdr: 0,
        courierCommissionIdr: 0,
        expenseClaimIdr: 0,
        refundIdr: 0,
      }),
    ).toBe(51_000);
  });
  // HD-16: imported fixed costs are one more term, but "none entered" is not "unknown".
  it('subtracts the fixed costs when entered, and ignores them when none were', () => {
    expect(netProfit({ ...month, fixedCostIdr: 200_000 })).toBe(2_000_000);
    expect(netProfit({ ...month, fixedCostIdr: 0 })).toBe(2_200_000);
    expect(netProfit({ ...month, fixedCostIdr: null })).toBe(2_200_000);
    expect(netProfit({ ...month })).toBe(2_200_000);
  });

  it('is unknown when the fixed cost is not a finite number', () => {
    expect(netProfit({ ...month, fixedCostIdr: Number.NaN })).toBeNull();
  });
});
