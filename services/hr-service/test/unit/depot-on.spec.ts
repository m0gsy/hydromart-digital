import {
  calendarDayWeights,
  depotOn,
  type DepotMove,
  type DepotOnEmployee,
} from '../../src/domain/depot-on';

const GALAKSI = '11111111-1111-1111-1111-111111111111';
const PEKAYON = '22222222-2222-2222-2222-222222222222';
const CIBUBUR = '33333333-3333-3333-3333-333333333333';

const emp: DepotOnEmployee = { homeDepotId: GALAKSI, depotId: GALAKSI };

function move(
  partial: Partial<DepotMove> & Pick<DepotMove, 'kind' | 'effectiveDate' | 'seq'>,
): DepotMove {
  return { fromDepotId: GALAKSI, toDepotId: PEKAYON, ...partial };
}

/** Loan to Pekayon 16-25 Oct: starts the 16th, back home the 26th. */
const loanStart = move({ kind: 'LOAN_START', effectiveDate: '2026-10-16', seq: 1 });
const loanEnd = move({
  kind: 'LOAN_END',
  effectiveDate: '2026-10-26',
  seq: 2,
  fromDepotId: PEKAYON,
  toDepotId: GALAKSI,
});

describe('depotOn', () => {
  it('without moves is the home depot, falling back to the live depot', () => {
    expect(depotOn(emp, [], '2026-10-10')).toBe(GALAKSI);
    expect(depotOn({ homeDepotId: null, depotId: PEKAYON }, [], '2026-10-10')).toBe(PEKAYON);
  });

  it('survives an employee with no depot at all (network-wide role)', () => {
    expect(depotOn({ homeDepotId: null, depotId: null }, [], '2026-10-10')).toBeNull();
    const m = move({ kind: 'PERMANENT', effectiveDate: '2026-10-05', seq: 1, toDepotId: null });
    expect(depotOn({ homeDepotId: null, depotId: null }, [m], '2026-10-06')).toBeNull();
  });

  it('a permanent move takes effect ON its effective date, not before', () => {
    const m = move({ kind: 'PERMANENT', effectiveDate: '2026-10-16', seq: 1 });
    expect(depotOn(emp, [m], '2026-10-15')).toBe(GALAKSI);
    expect(depotOn(emp, [m], '2026-10-16')).toBe(PEKAYON);
    expect(depotOn(emp, [m], '2027-01-01')).toBe(PEKAYON);
  });

  it('a loan covers start..end inclusive and returns home the day after', () => {
    const moves = [loanStart, loanEnd];
    expect(depotOn(emp, moves, '2026-10-15')).toBe(GALAKSI);
    expect(depotOn(emp, moves, '2026-10-16')).toBe(PEKAYON);
    expect(depotOn(emp, moves, '2026-10-25')).toBe(PEKAYON);
    expect(depotOn(emp, moves, '2026-10-26')).toBe(GALAKSI);
  });

  it('fills the gap before the first move with that move origin, not the live depot', () => {
    // The live depot has since changed to Pekayon; history must not be rewritten by it.
    const m = move({ kind: 'PERMANENT', effectiveDate: '2026-10-16', seq: 1 });
    expect(depotOn({ homeDepotId: PEKAYON, depotId: PEKAYON }, [m], '2026-09-01')).toBe(GALAKSI);
  });

  it('cuts a loan at its assignment end date when the sweep never wrote LOAN_END', () => {
    const dead = { ...loanStart, loanEndDate: '2026-10-25' };
    expect(depotOn(emp, [dead], '2026-10-25')).toBe(PEKAYON);
    expect(depotOn(emp, [dead], '2026-10-26')).toBe(GALAKSI);
    expect(depotOn(emp, [dead], '2026-12-01')).toBe(GALAKSI);
  });

  it('a back-to-back loan flips B straight to C with no stop at home (same day, seq order)', () => {
    const toC = move({
      kind: 'LOAN_START',
      effectiveDate: '2026-10-26',
      seq: 3,
      fromDepotId: PEKAYON,
      toDepotId: CIBUBUR,
      loanEndDate: '2026-10-31',
    });
    const firstLoan = { ...loanStart, loanEndDate: '2026-10-25' };
    expect(depotOn(emp, [firstLoan, toC], '2026-10-25')).toBe(PEKAYON);
    expect(depotOn(emp, [firstLoan, toC], '2026-10-26')).toBe(CIBUBUR);
    expect(depotOn(emp, [firstLoan, toC], '2026-11-01')).toBe(GALAKSI);
  });

  it('breaks same-day ties by seq, whatever order the rows arrive in', () => {
    const a = move({ kind: 'PERMANENT', effectiveDate: '2026-10-10', seq: 1, toDepotId: PEKAYON });
    const b = move({
      kind: 'PERMANENT',
      effectiveDate: '2026-10-10',
      seq: 2,
      fromDepotId: PEKAYON,
      toDepotId: CIBUBUR,
    });
    expect(depotOn(emp, [a, b], '2026-10-10')).toBe(CIBUBUR);
    expect(depotOn(emp, [b, a], '2026-10-10')).toBe(CIBUBUR);
  });

  it('does not mutate the ledger it is handed', () => {
    const moves = [loanEnd, loanStart];
    const copy = JSON.stringify(moves);
    depotOn(emp, moves, '2026-10-20');
    expect(JSON.stringify(moves)).toBe(copy);
  });

  it('rejects a malformed local date instead of guessing', () => {
    expect(() => depotOn(emp, [], '2026-13-01')).toThrow(RangeError);
    expect(() => depotOn(emp, [], '2026-02-30')).toThrow(RangeError);
    expect(() => depotOn(emp, [], '10/10/2026')).toThrow(RangeError);
  });

  it('is total and order-independent on random ledgers', () => {
    let seed = 7;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const depots = [GALAKSI, PEKAYON, CIBUBUR, null];
    for (let i = 0; i < 500; i += 1) {
      const moves: DepotMove[] = [];
      const n = Math.floor(rnd() * 6);
      for (let k = 0; k < n; k += 1) {
        const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
        moves.push({
          kind: (['PERMANENT', 'LOAN_START', 'LOAN_END'] as const)[Math.floor(rnd() * 3)],
          effectiveDate: `2026-10-${day}`,
          seq: k + 1,
          fromDepotId: depots[Math.floor(rnd() * 4)],
          toDepotId: depots[Math.floor(rnd() * 4)],
          loanEndDate: rnd() < 0.3 ? `2026-10-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}` : null,
        });
      }
      for (let d = 1; d <= 31; d += 1) {
        const date = `2026-10-${String(d).padStart(2, '0')}`;
        const forward = depotOn(emp, moves, date);
        expect(forward === null || typeof forward === 'string').toBe(true);
        expect(depotOn(emp, [...moves].reverse(), date)).toBe(forward);
      }
    }
  });
});

describe('calendarDayWeights', () => {
  const october = { from: '2026-10-01', to: '2026-10-31' };

  it('splits October 21 / 10 for the 16-25 loan (calendar days, not working days)', () => {
    const w = calendarDayWeights(emp, [loanStart, loanEnd], october);
    expect(w.get(GALAKSI)).toBe(21);
    expect(w.get(PEKAYON)).toBe(10);
  });

  it('is all home in February with no moves, whatever the month length', () => {
    const w = calendarDayWeights(emp, [], { from: '2027-02-01', to: '2027-02-28' });
    expect([...w]).toEqual([[GALAKSI, 28]]);
  });

  it('clips to the employment window (joined the 10th)', () => {
    const w = calendarDayWeights(emp, [loanStart, loanEnd], { ...october, windowFrom: '2026-10-10' });
    expect(w.get(GALAKSI)).toBe(12);
    expect(w.get(PEKAYON)).toBe(10);
  });

  it('clips to the employment window (left on the 20th)', () => {
    const w = calendarDayWeights(emp, [loanStart, loanEnd], { ...october, windowTo: '2026-10-20' });
    expect(w.get(GALAKSI)).toBe(15);
    expect(w.get(PEKAYON)).toBe(5);
  });

  it('is empty when the window misses the period entirely (caller falls back to home)', () => {
    const w = calendarDayWeights(emp, [], { ...october, windowFrom: '2026-11-05' });
    expect(w.size).toBe(0);
  });

  it('drops a null-depot day rather than inventing a key for it', () => {
    const w = calendarDayWeights({ homeDepotId: null, depotId: null }, [], october);
    expect(w.size).toBe(0);
  });
});
