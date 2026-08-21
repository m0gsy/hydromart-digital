'use client';

/**
 * G1 — the item a guest tried to add before the login gate stopped them.
 *
 * Four buttons gate on `customer` (product card, two on the product detail screen, the
 * favourite button) and all four did the same two things wrong: they threw the item away,
 * and they sent the shopper to the PRODUCT DETAIL page afterwards rather than back to the
 * screen they were on. Someone adding a gallon from the catalog signed in, landed on a page
 * they had not asked for, and found an empty cart — so the tap that started the purchase
 * was the tap that lost it.
 *
 * Same module-singleton shape as `location-store`, and deliberately no state library for
 * one small value. Two differences from that store, both on purpose:
 *
 *  - `sessionStorage`, not `localStorage`. An intent to buy one gallon is worth carrying
 *    across an OTP round trip; it is not worth resurrecting next week on a shared phone.
 *  - `take()` rather than `get()`. It is consumed exactly once. A pending add that survived
 *    its own flush would add the item again on the next sign-in, which is the failure this
 *    module must not invent while fixing a smaller one.
 */

export interface PendingAdd {
  productId: string;
  quantity: number;
}

const KEY = 'hm.pending-add';

export function setPendingAdd(pending: PendingAdd): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* private mode, quota, a browser that refuses — the gate still works, the item is lost */
  }
}

/** Reads and clears in one step: this intent is consumed exactly once. */
export function takePendingAdd(): PendingAdd | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingAdd>;
    // Anything hand-edited or written by an older build is dropped rather than posted:
    // a bad productId here becomes a 400 the shopper never asked for.
    if (typeof parsed.productId !== 'string' || !parsed.productId) return null;
    const quantity = typeof parsed.quantity === 'number' && parsed.quantity > 0 ? Math.floor(parsed.quantity) : 1;
    return { productId: parsed.productId, quantity };
  } catch {
    return null;
  }
}

/**
 * Where the login gate should return to: the screen the shopper is actually on, including
 * its query, because the catalog keeps its filters there. Callers used to hard-code the
 * product detail route, which is how "add to cart" became "go and read about it instead".
 */
export function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}
