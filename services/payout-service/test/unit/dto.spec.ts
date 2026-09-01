import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ApplySchemeDto, ApplySchemeItemDto } from '../../src/modules/dto/commission.dto';
import { ApplyEarningRuleDto } from '../../src/modules/dto/earning-rule.dto';
import { SubmitExpenseDto } from '../../src/modules/dto/expense-claim.dto';
import { RequestWithdrawalDto, SettleWithdrawalDto } from '../../src/modules/dto/payout.dto';

// Validation is a money boundary — a loosened decorator lets a negative payout or a
// 500% commission through. These lock the rules that actually guard rupiah, not the
// trivial passthrough fields.

/** Property names that failed validation, for precise assertions. */
function invalidProps<T extends object>(cls: new () => T, payload: unknown): string[] {
  const dto = plainToInstance(cls, payload);
  return validateSync(dto as object).map((e) => e.property);
}

describe('RequestWithdrawalDto', () => {
  const valid = { amount: 8420000, bankAccountRef: 'BCA ···· 4821' };

  it('accepts a positive amount and a bank ref', () => {
    expect(invalidProps(RequestWithdrawalDto, valid)).toEqual([]);
  });

  it.each([0, -1, 100.5])('rejects non-positive/non-integer amount %p', (amount) => {
    expect(invalidProps(RequestWithdrawalDto, { ...valid, amount })).toContain('amount');
  });

  it('rejects an empty bank ref', () => {
    expect(invalidProps(RequestWithdrawalDto, { ...valid, bankAccountRef: '' })).toContain(
      'bankAccountRef',
    );
  });
});

/*
 * The reason a rejected transfer carries. It lands on the compensating ledger row rather
 * than a column of its own, so the only guard that matters is that it stays a bounded
 * string — a free-text field that reaches the money ledger without a length is how a log
 * line becomes a payload.
 */
describe('SettleWithdrawalDto', () => {
  it('accepts no reason at all — PAID does not need one', () => {
    expect(invalidProps(SettleWithdrawalDto, {})).toEqual([]);
  });

  it('accepts a short reason', () => {
    expect(invalidProps(SettleWithdrawalDto, { reason: 'Rekening tutup' })).toEqual([]);
  });

  it('rejects a reason past 300 characters', () => {
    expect(invalidProps(SettleWithdrawalDto, { reason: 'x'.repeat(301) })).toContain('reason');
  });

  it('rejects a non-string reason', () => {
    expect(invalidProps(SettleWithdrawalDto, { reason: 42 })).toContain('reason');
  });
});

describe('SubmitExpenseDto', () => {
  const valid = { category: 'FUEL', amount: 25000, description: 'Bensin motor' };

  it('accepts a known category and positive amount', () => {
    expect(invalidProps(SubmitExpenseDto, valid)).toEqual([]);
  });

  it('rejects an unknown category', () => {
    expect(invalidProps(SubmitExpenseDto, { ...valid, category: 'BRIBE' })).toContain('category');
  });

  it('rejects a non-positive amount', () => {
    expect(invalidProps(SubmitExpenseDto, { ...valid, amount: 0 })).toContain('amount');
  });
});

describe('ApplySchemeItemDto commission pct', () => {
  const valid = { depotId: '11111111-1111-4111-8111-111111111111', pct: 20 };

  it('accepts 0..100', () => {
    expect(invalidProps(ApplySchemeItemDto, { ...valid, pct: 0 })).toEqual([]);
    expect(invalidProps(ApplySchemeItemDto, { ...valid, pct: 100 })).toEqual([]);
  });

  it.each([-1, 101])('rejects pct out of range %p', (pct) => {
    expect(invalidProps(ApplySchemeItemDto, { ...valid, pct })).toContain('pct');
  });
});

describe('ApplySchemeDto', () => {
  const item = { depotId: '11111111-1111-4111-8111-111111111111', pct: 20 };

  it('accepts a dated scheme with at least one item', () => {
    expect(invalidProps(ApplySchemeDto, { effectiveDate: '2026-08-01', items: [item] })).toEqual(
      [],
    );
  });

  it('rejects an empty items array', () => {
    expect(invalidProps(ApplySchemeDto, { effectiveDate: '2026-08-01', items: [] })).toContain(
      'items',
    );
  });
});

describe('ApplyEarningRuleDto', () => {
  const valid = {
    baseFare: 5000,
    peakBonus: 2000,
    onTimeBonus: 1000,
    peakStartHour: 17,
    peakEndHour: 20,
    effectiveDate: '2026-08-01',
  };

  it('accepts a well-formed rule', () => {
    expect(invalidProps(ApplyEarningRuleDto, valid)).toEqual([]);
  });

  it('rejects a negative base fare', () => {
    expect(invalidProps(ApplyEarningRuleDto, { ...valid, baseFare: -1 })).toContain('baseFare');
  });

  it('rejects an out-of-clock peak window', () => {
    expect(invalidProps(ApplyEarningRuleDto, { ...valid, peakStartHour: 24 })).toContain(
      'peakStartHour',
    );
    expect(invalidProps(ApplyEarningRuleDto, { ...valid, peakEndHour: 25 })).toContain(
      'peakEndHour',
    );
  });
});
