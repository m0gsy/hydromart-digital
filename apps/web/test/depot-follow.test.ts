// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An employee lent to another depot changes depot on the server; the browser has to follow.
 * These are the two decisions that make it follow without stranding anyone.
 */

const session = vi.hoisted(() => ({ assigned: null as string | null | undefined }));

vi.mock('../src/lib/session-store', () => ({
  getSession: () => ({ customer: { id: 'u1', assignedDepotId: session.assigned } }),
  setSession: () => {},
  subscribe: () => () => {},
}));

import { queuedDepotIsStale, reconcileDepot } from '../src/lib/depot-follow';
import { getDepot, setDepot } from '../src/lib/depot-store';

beforeEach(() => {
  window.localStorage.clear();
  setDepot(null);
  session.assigned = null;
});
afterEach(() => setDepot(null));

describe('reconcileDepot', () => {
  it('moves the stored selection to the account\'s one depot', () => {
    setDepot('depot-A');
    expect(reconcileDepot({ assignedDepotId: 'depot-B' })).toBe(true);
    expect(getDepot()).toBe('depot-B');
  });

  it('does nothing when they already match (no reload for no reason)', () => {
    setDepot('depot-B');
    expect(reconcileDepot({ assignedDepotId: 'depot-B' })).toBe(false);
  });

  it('leaves accounts above a single depot to their own choice', () => {
    setDepot('depot-A');
    expect(reconcileDepot({ assignedDepotId: null })).toBe(false);
    expect(reconcileDepot({})).toBe(false);
    expect(getDepot()).toBe('depot-A');
  });

  it('sets a depot when none was stored yet', () => {
    expect(reconcileDepot({ assignedDepotId: 'depot-B' })).toBe(true);
    expect(getDepot()).toBe('depot-B');
  });
});

describe('queuedDepotIsStale', () => {
  it('is stale only on positive evidence: a job for one depot, an account at another', () => {
    session.assigned = 'depot-B';
    expect(queuedDepotIsStale('depot-A')).toBe(true);
    expect(queuedDepotIsStale('depot-B')).toBe(false);
  });

  it('never holds a job back when either side is unknown', () => {
    session.assigned = null;
    expect(queuedDepotIsStale('depot-A')).toBe(false);
    session.assigned = undefined;
    expect(queuedDepotIsStale('depot-A')).toBe(false);
    session.assigned = 'depot-B';
    expect(queuedDepotIsStale(null)).toBe(false);
    expect(queuedDepotIsStale(undefined)).toBe(false);
  });
});
