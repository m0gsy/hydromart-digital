import { describe, expect, it } from 'vitest';

import { droppedFree, freeShortfall } from '@/lib/counter-free';

describe('freeShortfall', () => {
  it('counts the free units against the stock the paid ones already use', () => {
    // Beli 2 gratis 1 with two on the shelf: the stepper allowed 2, the sale needs 3.
    expect(
      freeShortfall([{ productId: 'g', quantity: 1 }], new Map([['g', 2]]), new Map([['g', 2]])),
    ).toEqual([{ productId: 'g', need: 3, have: 2 }]);
  });

  it('says nothing when the shelf covers paid and free', () => {
    expect(
      freeShortfall([{ productId: 'g', quantity: 1 }], new Map([['g', 2]]), new Map([['g', 5]])),
    ).toEqual([]);
  });

  it('treats a gift of an unstocked product as short', () => {
    expect(freeShortfall([{ productId: 'tutup', quantity: 2 }], new Map(), new Map())).toEqual([
      { productId: 'tutup', need: 2, have: 0 },
    ]);
  });
});

describe('droppedFree', () => {
  it('names the free units the order came back without', () => {
    expect(
      droppedFree(
        [
          { productId: 'g', quantity: 1 },
          { productId: 'tutup', quantity: 2 },
        ],
        [
          { productId: 'g', unitPrice: 8000, quantity: 2 },
          { productId: 'g', unitPrice: 0, quantity: 1 },
        ],
      ),
    ).toEqual([{ productId: 'tutup', quantity: 2 }]);
  });

  it('is empty when every promised unit is on the order', () => {
    expect(
      droppedFree([{ productId: 'g', quantity: 1 }], [{ productId: 'g', unitPrice: 0, quantity: 1 }]),
    ).toEqual([]);
  });
});
