// @vitest-environment jsdom
/**
 * G1 — the item a guest tried to add before the login gate stopped them.
 *
 * The rules worth pinning are the ones that turn a small fix into a bug if they slip:
 * consumed exactly once, and never trusted blindly on the way back in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentPath, setPendingAdd, takePendingAdd } from '@/lib/pending-add';

const KEY = 'hm.pending-add';

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe('pending add', () => {
  it('carries the item across the sign-in trip', () => {
    setPendingAdd({ productId: 'p1', quantity: 3 });
    expect(takePendingAdd()).toEqual({ productId: 'p1', quantity: 3 });
  });

  // A pending add that survived its own flush would add the item again on the NEXT sign-in
  // — a bug bigger than the one this module exists to fix.
  it('is consumed exactly once', () => {
    setPendingAdd({ productId: 'p1', quantity: 1 });
    expect(takePendingAdd()).not.toBeNull();
    expect(takePendingAdd()).toBeNull();
  });

  it('is nothing when nothing was stashed', () => {
    expect(takePendingAdd()).toBeNull();
  });

  // Hand-edited storage, or a value written by an older build. Posting it would be a 400
  // the shopper never asked for.
  it('drops a stash with no usable product id', () => {
    for (const bad of ['{}', '{"productId":""}', '{"productId":42}', 'not json']) {
      sessionStorage.setItem(KEY, bad);
      expect(takePendingAdd()).toBeNull();
    }
  });

  it('falls back to one for a quantity that is not a positive number', () => {
    for (const q of ['0', '-2', '"three"', 'null']) {
      sessionStorage.setItem(KEY, `{"productId":"p1","quantity":${q}}`);
      expect(takePendingAdd()).toEqual({ productId: 'p1', quantity: 1 });
    }
  });

  it('floors a fractional quantity rather than sending it', () => {
    sessionStorage.setItem(KEY, '{"productId":"p1","quantity":2.7}');
    expect(takePendingAdd()).toEqual({ productId: 'p1', quantity: 2 });
  });

  // The catalog keeps its filters in the query string, so dropping it lands the shopper on
  // an unfiltered list — the same "somewhere I did not ask for" this fix is about.
  it('returns to the screen the shopper is on, query and all', () => {
    window.history.pushState({}, '', '/products?category=galon&search=aqua');
    expect(currentPath()).toBe('/products?category=galon&search=aqua');
  });
});
