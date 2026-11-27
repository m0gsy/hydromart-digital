import { describe, expect, it } from 'vitest';

import { canSetByHand, isTerminal, PROSPECT_STATUSES, statusTargets } from '@/lib/prospect-status';

// The server table (customer-service domain/b2b-prospect-status.ts), written out pair by pair.
const ALLOWED = new Set([
  'NEW>CONTACTED',
  'NEW>LOST',
  'CONTACTED>VISITED',
  'CONTACTED>INTERESTED',
  'CONTACTED>LOST',
  'VISITED>CONTACTED',
  'VISITED>INTERESTED',
  'VISITED>LOST',
  'INTERESTED>VISITED',
  'INTERESTED>LOST',
  'LOST>NEW',
]);

describe('prospect status table', () => {
  it('agrees with the server on every one of the 49 pairs (NEW to VISITED is a GPS check-in, not a hand move)', () => {
    let pairs = 0;
    for (const from of PROSPECT_STATUSES) {
      for (const to of PROSPECT_STATUSES) {
        pairs += 1;
        expect(canSetByHand(from, to), `${from} -> ${to}`).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
    expect(pairs).toBe(49);
  });

  it('knows the terminal states', () => {
    expect(PROSPECT_STATUSES.filter(isTerminal)).toEqual(['CONVERTED', 'DO_NOT_CONTACT']);
  });

  it('offers a LOST row back to NEW to a manager only', () => {
    expect(statusTargets('LOST', true)).toEqual(['NEW']);
    expect(statusTargets('LOST', false)).toEqual([]);
    expect(statusTargets('CONTACTED', false)).toEqual(['VISITED', 'INTERESTED', 'LOST']);
  });
});
