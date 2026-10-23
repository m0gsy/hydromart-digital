// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HELD_TTL_MS,
  MAX_HELD,
  addHeld,
  itemCount,
  loadHeld,
  removeHeld,
  restoreQuantities,
  saveHeld,
  type HeldBasket,
} from '@/lib/held-baskets';

const basket = (o: Partial<HeldBasket> = {}): HeldBasket => ({
  id: 'h-1',
  savedAt: 1_000_000,
  qty: { 'p-air': 3 },
  name: 'Budi',
  phone: '0812',
  voucher: '',
  buyerId: null,
  ...o,
});

beforeEach(() => window.localStorage.clear());

describe('held baskets · storage', () => {
  it('round-trips a basket for the depot it was held at', () => {
    saveHeld('depot-1', [basket()]);
    expect(loadHeld('depot-1', 1_000_500)).toEqual([basket()]);
  });

  it('keeps depots apart', () => {
    saveHeld('depot-1', [basket()]);
    expect(loadHeld('depot-2', 1_000_500)).toEqual([]);
  });

  it('drops a basket older than the working day', () => {
    saveHeld('depot-1', [basket({ savedAt: 1_000_000 })]);
    expect(loadHeld('depot-1', 1_000_000 + HELD_TTL_MS)).toEqual([]);
    expect(loadHeld('depot-1', 1_000_000 + HELD_TTL_MS - 1)).toHaveLength(1);
  });

  it('drops a basket stamped in the future (a clock set back)', () => {
    saveHeld('depot-1', [basket({ savedAt: 9_000_000 })]);
    expect(loadHeld('depot-1', 1_000_000)).toEqual([]);
  });

  it('survives garbage in storage', () => {
    window.localStorage.setItem('hm.walkin.held.depot-1', '{not json');
    expect(loadHeld('depot-1')).toEqual([]);
    window.localStorage.setItem('hm.walkin.held.depot-1', JSON.stringify({ a: 1 }));
    expect(loadHeld('depot-1')).toEqual([]);
  });

  it('ignores a malformed entry but keeps its good neighbours', () => {
    window.localStorage.setItem(
      'hm.walkin.held.depot-1',
      JSON.stringify([basket(), { id: 'x' }, basket({ id: 'h-2', qty: { a: -1 } }), basket({ id: 'h-3' })]),
    );
    expect(loadHeld('depot-1', 1_000_500).map((b) => b.id)).toEqual(['h-1', 'h-3']);
  });

  it('keeps the delivery form with the basket, and refuses a malformed one', () => {
    const delivery = { on: true, recipient: 'Budi', phone: '0812', line: 'Jl. Dago 1', city: 'Bandung', notes: '' };
    saveHeld('depot-1', [basket({ delivery }), basket({ id: 'bad', delivery: { on: 'yes' } as never })]);
    const back = loadHeld('depot-1', 1_000_500);
    expect(back.map((b) => b.id)).toEqual(['h-1']);
    expect(back[0]?.delivery).toEqual(delivery);
  });

  it('removes the key when the last basket goes', () => {
    saveHeld('depot-1', [basket()]);
    saveHeld('depot-1', []);
    expect(window.localStorage.getItem('hm.walkin.held.depot-1')).toBeNull();
  });

  it('reports a store that refuses the write instead of throwing', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    try {
      expect(saveHeld('depot-1', [basket()])).toBe(false);
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('held baskets · list rules', () => {
  it('adds up to the cap and then refuses', () => {
    let list: HeldBasket[] = [];
    for (let i = 0; i < MAX_HELD; i += 1) {
      const r = addHeld(list, basket({ id: `h-${i}` }));
      expect(r.added).toBe(true);
      list = r.list;
    }
    const full = addHeld(list, basket({ id: 'one-too-many' }));
    expect(full.added).toBe(false);
    expect(full.list).toHaveLength(MAX_HELD);
  });

  it('removes by id and leaves the rest', () => {
    expect(removeHeld([basket({ id: 'a' }), basket({ id: 'b' })], 'a').map((b) => b.id)).toEqual(['b']);
  });

  it('counts the items, not the lines', () => {
    expect(itemCount(basket({ qty: { a: 3, b: 2 } }))).toBe(5);
  });
});

describe('held baskets · restoring after stock moved', () => {
  const available = new Map([
    ['a', 5],
    ['b', 1],
  ]);

  it('restores in full when stock still covers it', () => {
    expect(restoreQuantities(basket({ qty: { a: 3 } }), available)).toEqual({ qty: { a: 3 }, adjusted: 0 });
  });

  it('cuts a line to what is left and says so', () => {
    expect(restoreQuantities(basket({ qty: { a: 9 } }), available)).toEqual({ qty: { a: 5 }, adjusted: 1 });
  });

  it('drops a line with nothing left, and a product the depot no longer lists', () => {
    expect(restoreQuantities(basket({ qty: { a: 2, gone: 4 } }), available)).toEqual({
      qty: { a: 2 },
      adjusted: 1,
    });
  });
});
