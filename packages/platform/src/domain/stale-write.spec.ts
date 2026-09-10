import { StaleWriteError, assertFresh, isDecisionOnlyPatch } from './stale-write';

const stored = new Date('2026-09-09T10:00:00.000Z');

describe('assertFresh', () => {
  it('lets a write through when the caller saw exactly what is stored', () => {
    expect(() => assertFresh(stored, '2026-09-09T10:00:00.000Z')).not.toThrow();
  });

  it('refuses a write whose author read an older version', () => {
    // The whole defect in one line: this is the second admin, saving a form they filled
    // in before the first admin's change landed.
    expect(() => assertFresh(stored, '2026-09-09T09:59:00.000Z')).toThrow(StaleWriteError);
  });

  it('refuses a write that says nothing about what it saw', () => {
    // Fails CLOSED on purpose: a client that does not name a version is exactly the
    // client that overwrites blindly, which is the behaviour this replaces.
    expect(() => assertFresh(stored, undefined)).toThrow(StaleWriteError);
    expect(() => assertFresh(stored, null)).toThrow(StaleWriteError);
    expect(() => assertFresh(stored, '')).toThrow(StaleWriteError);
  });

  it('refuses a stamp that is not a date at all', () => {
    // Otherwise the guard is optional for anyone who sends junk.
    expect(() => assertFresh(stored, 'terserah')).toThrow(StaleWriteError);
  });

  it('allows the first write when there is no row yet', () => {
    // Nothing to lose, and a settings page has to be savable before it has ever been saved.
    expect(() => assertFresh(null, undefined)).not.toThrow();
    expect(() => assertFresh(undefined, '2026-01-01T00:00:00.000Z')).not.toThrow();
  });

  it('answers 409, so the console can tell this apart from a validation failure', () => {
    const err = new StaleWriteError();
    expect(err.status).toBe(409);
    expect(err.code).toBe('STALE_WRITE');
  });

  it('compares the instant, not the text', () => {
    // The same moment written in another offset is the same version.
    expect(() => assertFresh(stored, '2026-09-09T17:00:00.000+07:00')).not.toThrow();
  });
});

describe('isDecisionOnlyPatch', () => {
  it('treats a lone active flag as the decision it is', () => {
    expect(isDecisionOnlyPatch({ active: true })).toBe(true);
    expect(isDecisionOnlyPatch({ active: false })).toBe(true);
  });

  it('ignores the undefined properties a class-transformer DTO always carries', () => {
    // Without the filter this object has six keys and the predicate never holds — the
    // exemption would be dead code and every reactivate button would 409 on.
    expect(
      isDecisionOnlyPatch({
        active: true,
        name: undefined,
        deliveryFee: undefined,
        seenUpdatedAt: undefined,
      }),
    ).toBe(true);
  });

  it('refuses anything carrying a second field somebody could lose', () => {
    expect(isDecisionOnlyPatch({ active: true, name: 'Depot Baru' })).toBe(false);
    expect(isDecisionOnlyPatch({ operatingHours: {}, holidays: [] })).toBe(false);
    expect(isDecisionOnlyPatch({ paymentBankAccountNumber: '123' })).toBe(false);
    expect(isDecisionOnlyPatch({})).toBe(false);
  });
});
