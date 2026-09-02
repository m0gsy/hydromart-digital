import {
  loanDeductionFor,
  loanRemainingAfter,
  loanIsSettled,
  nextPeriod,
  type LoanTerms,
} from '../../src/domain/loan';

// 1,000,000 principal, 300,000/month from 2026-07 → 300k,300k,300k,100k over 4 months.
const loan: LoanTerms = {
  principal: 1_000_000,
  installmentAmount: 300_000,
  startPeriod: '2026-07',
};

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

describe('nextPeriod', () => {
  it('walks a month forward, rolling the year at December', () => {
    expect(nextPeriod('2026-07')).toBe('2026-08');
    expect(nextPeriod('2026-09')).toBe('2026-10');
    expect(nextPeriod('2026-12')).toBe('2027-01');
  });
});

// CA-1-05. The balance shown next to a kasbon was months-elapsed × installment: a month
// whose payroll never ran, or one that could only afford part of an installment, counted as
// collected. The badge said "Lunas" over a debt payroll was still deducting — and
// `loanDeductionFor` had already been given the real ledger (D4), so the two numbers on the
// same screen came from two different sources.
describe('loanRemainingAfter with the real repayment ledger', () => {
  it('keeps owing what was never actually collected', () => {
    // Four months elapsed: the calendar says cleared.
    expect(loanRemainingAfter(loan, '2026-10')).toBe(0);
    expect(loanIsSettled(loan, '2026-10')).toBe(true);
    // The payslips only ever took 300.000.
    expect(loanRemainingAfter(loan, '2026-10', 300_000)).toBe(700_000);
    expect(loanIsSettled(loan, '2026-10', 300_000)).toBe(false);
  });

  it('a period whose payroll was never generated shows the full balance', () => {
    expect(loanRemainingAfter(loan, '2026-07', 0)).toBe(1_000_000);
  });

  it('never reports a negative balance when the ledger over-collected', () => {
    expect(loanRemainingAfter(loan, '2026-10', 1_500_000)).toBe(0);
    expect(loanIsSettled(loan, '2026-10', 1_500_000)).toBe(true);
  });
});

// idempotency: re-evaluating the same period yields the same deduction (no mutable state).
describe('idempotency', () => {
  it('same (loan, period) → same deduction on repeat calls', () => {
    expect(loanDeductionFor(loan, '2026-08')).toBe(loanDeductionFor(loan, '2026-08'));
  });
});

// D4: the elapsed-months arithmetic assumes every earlier period collected a full
// installment. Once a period can only collect part of one (net is floored at 0), that
// assumption writes off the difference — so payroll passes what was ACTUALLY taken.
describe('paidSoFar overrides the elapsed-months assumption', () => {
  it('keeps asking for the installment while the ledger says it is unpaid', () => {
    // Five months elapsed on a 1.000.000 loan at 300.000: "settled" by elapsed months.
    expect(loanDeductionFor(loan, '2026-11')).toBe(0);
    expect(loanDeductionFor(loan, '2026-11', 600_000)).toBe(300_000);
  });

  it('never collects more than the outstanding balance', () => {
    expect(loanDeductionFor(loan, '2026-11', 900_000)).toBe(100_000);
    expect(loanDeductionFor(loan, '2026-11', 1_000_000)).toBe(0);
  });
});
