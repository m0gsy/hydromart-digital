import { loanDeductionFor, loanRemainingAfter, loanIsSettled, type LoanTerms } from '../../src/domain/loan';

// 1,000,000 principal, 300,000/month from 2026-07 → 300k,300k,300k,100k over 4 months.
const loan: LoanTerms = { principal: 1_000_000, installmentAmount: 300_000, startPeriod: '2026-07' };

describe('loanDeductionFor', () => {
  it('is 0 before the loan starts', () => {
    expect(loanDeductionFor(loan, '2026-06')).toBe(0);
  });
  it('deducts a full installment each month', () => {
    expect(loanDeductionFor(loan, '2026-07')).toBe(300_000);
    expect(loanDeductionFor(loan, '2026-08')).toBe(300_000);
    expect(loanDeductionFor(loan, '2026-09')).toBe(300_000);
  });
  it('deducts only the remaining stub in the final month', () => {
    expect(loanDeductionFor(loan, '2026-10')).toBe(100_000); // 1,000,000 - 900,000
  });
  it('is 0 once fully paid', () => {
    expect(loanDeductionFor(loan, '2026-11')).toBe(0);
  });
  it('handles a zero installment safely', () => {
    expect(loanDeductionFor({ ...loan, installmentAmount: 0 }, '2026-07')).toBe(0);
  });
});

describe('loanRemainingAfter', () => {
  it('tracks the outstanding balance down to zero', () => {
    expect(loanRemainingAfter(loan, '2026-07')).toBe(700_000);
    expect(loanRemainingAfter(loan, '2026-09')).toBe(100_000);
    expect(loanRemainingAfter(loan, '2026-10')).toBe(0);
    expect(loanRemainingAfter(loan, '2026-12')).toBe(0);
  });
});

describe('loanIsSettled', () => {
  it('is true only once cleared', () => {
    expect(loanIsSettled(loan, '2026-09')).toBe(false);
    expect(loanIsSettled(loan, '2026-10')).toBe(true);
  });
});

// idempotency: re-evaluating the same period yields the same deduction (no mutable state).
describe('idempotency', () => {
  it('same (loan, period) → same deduction on repeat calls', () => {
    expect(loanDeductionFor(loan, '2026-08')).toBe(loanDeductionFor(loan, '2026-08'));
  });
});
