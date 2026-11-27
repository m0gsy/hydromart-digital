import { describe, expect, it } from 'vitest';

import { parsePin, validPin } from '@/lib/prospect-pin';

describe('prospect pin', () => {
  it.each([
    ['-6.2, 106.8', { lat: -6.2, lng: 106.8 }],
    ['-6.2 106.8', { lat: -6.2, lng: 106.8 }],
    ['  -6.2;106.8  ', { lat: -6.2, lng: 106.8 }],
    ['5, 95', { lat: 5, lng: 95 }],
  ])('reads %j', (text, pin) => {
    expect(parsePin(text)).toEqual(pin);
  });

  it.each([
    ['', 'empty'],
    ['-6.2', 'one number'],
    ['-6,2, 106,8', 'a decimal comma (four tokens)'],
    ['abc, def', 'words'],
    ['0, 0', 'the (0, 0) a missing fix reads as'],
    ['91, 106', 'latitude out of range'],
    ['-6.2, 181', 'longitude out of range'],
    ['1e3, 5', 'exponent'],
  ])('refuses %j (%s)', (text) => {
    expect(parsePin(text)).toBeNull();
  });

  it('judges a fix: finite, on the globe, not (0, 0)', () => {
    expect(validPin(-6.2, 106.8)).toBe(true);
    expect(validPin(0, 5)).toBe(true);
    expect(validPin(0, 0)).toBe(false);
    expect(validPin(Number.NaN, 5)).toBe(false);
    expect(validPin(5, Number.POSITIVE_INFINITY)).toBe(false);
    expect(validPin(-91, 5)).toBe(false);
  });
});
