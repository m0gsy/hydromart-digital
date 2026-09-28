import { describe, expect, it } from 'vitest';

import { orderNeeded, stockRunway, trendLabel } from '@/lib/forecast';

/*
 * How long the stock on hand lasts, and how much still has to be ordered.
 *
 * The forecast page turned "no stock line for this product" and "nothing sells" into the same
 * word, "Aman" (safe). A product the depot does not track is not safe — it is UNKNOWN — and a
 * page that says safe about a product it has no stock figure for is the worst thing a restock
 * screen can do. The three states are told apart here, so the page cannot merge them again.
 */
describe('stockRunway', () => {
  it('counts the whole days the stock lasts at the forecast daily demand', () => {
    expect(stockRunway(30, 10)).toEqual({ state: 'days', days: 3 });
    // A partial day is not a day: 25 at 10/day runs out during day 3, so 2 full days remain.
    expect(stockRunway(25, 10)).toEqual({ state: 'days', days: 2 });
  });

  it('says out of stock now, never a negative number of days, when nothing is available', () => {
    expect(stockRunway(0, 10)).toEqual({ state: 'days', days: 0 });
    // Reserved stock can exceed on-hand; the runway is still "none", not -1.
    expect(stockRunway(-4, 10)).toEqual({ state: 'days', days: 0 });
  });

  it('is unknown, not safe, when the depot has no stock figure for the product', () => {
    expect(stockRunway(undefined, 10)).toEqual({ state: 'unknown' });
    // Unknown wins even when nothing sells: without a stock figure there is nothing to call safe.
    expect(stockRunway(undefined, 0)).toEqual({ state: 'unknown' });
  });

  it('is "no demand" — genuinely safe — only when stock is known and nothing is selling', () => {
    expect(stockRunway(50, 0)).toEqual({ state: 'no-demand' });
    expect(stockRunway(50, -1)).toEqual({ state: 'no-demand' });
  });
});

describe('orderNeeded', () => {
  it('is what the forecast wants minus what is already on the shelf, rounded up', () => {
    expect(orderNeeded(100, 30)).toBe(70);
    expect(orderNeeded(100.2, 30)).toBe(71);
  });

  it('is zero, never negative, when the shelf already holds enough', () => {
    expect(orderNeeded(40, 40)).toBe(0);
    expect(orderNeeded(40, 90)).toBe(0);
  });

  it('is unknown when there is no stock figure to subtract', () => {
    expect(orderNeeded(100, undefined)).toBeNull();
  });
});

describe('trendLabel', () => {
  it('labels a clear positive slope as rising', () => {
    expect(trendLabel(0.5)).toBe('↑ rising');
    expect(trendLabel(0.06)).toBe('↑ rising');
  });

  it('labels a clear negative slope as falling', () => {
    expect(trendLabel(-0.5)).toBe('↓ falling');
    expect(trendLabel(-0.06)).toBe('↓ falling');
  });

  it('labels near-zero slopes (within ±epsilon) as flat', () => {
    expect(trendLabel(0)).toBe('→ flat');
    expect(trendLabel(0.05)).toBe('→ flat');
    expect(trendLabel(-0.05)).toBe('→ flat');
  });
});
