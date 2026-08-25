import { describe, expect, it } from 'vitest';

import { PDP_SLA_HOURS, pdpDeadline, pdpOverdue } from '@/lib/pdp-sla';

/**
 * K1.6. The screen already said WHAT happens to a data request — head office reviews it,
 * a deletion is permanent, payment history is kept without an identity. What it never said
 * was WHEN, and that is the half that is a legal commitment rather than an explanation.
 */
describe('pdp SLA', () => {
  const REQUESTED = '2026-08-25T10:00:00.000Z';

  it('is the 3x24 hours UU PDP names', () => {
    expect(PDP_SLA_HOURS).toBe(72);
    expect(pdpDeadline(REQUESTED).toISOString()).toBe('2026-08-28T10:00:00.000Z');
  });

  it('is not overdue a minute before the deadline', () => {
    expect(pdpOverdue(REQUESTED, 'PENDING', new Date('2026-08-28T09:59:00.000Z'))).toBe(false);
  });

  it('is overdue a minute after it', () => {
    expect(pdpOverdue(REQUESTED, 'PENDING', new Date('2026-08-28T10:01:00.000Z'))).toBe(true);
  });

  /*
   * Finished work is never overdue, however old. A queue that marks completed rows red is
   * a queue that teaches people to ignore red.
   */
  it('never calls a decided request overdue', () => {
    const longAfter = new Date('2027-01-01T00:00:00.000Z');
    expect(pdpOverdue(REQUESTED, 'COMPLETED', longAfter)).toBe(false);
    expect(pdpOverdue(REQUESTED, 'REJECTED', longAfter)).toBe(false);
  });

  it('takes a Date as readily as the ISO string the API sends', () => {
    expect(pdpDeadline(new Date(REQUESTED)).getTime()).toBe(pdpDeadline(REQUESTED).getTime());
  });
});
