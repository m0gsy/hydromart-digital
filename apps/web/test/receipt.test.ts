// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { printReceipt } from '../src/lib/receipt';
import { id as idDict } from '../src/lib/dictionaries/id';
import type { Order } from '../src/lib/types';

/**
 * The receipt is built outside React, so it takes the translator instead of calling a
 * hook. Resolving against the REAL Indonesian dictionary keeps the assertions below
 * meaningful — a key the dictionary is missing prints itself and fails here.
 */
const I18N = {
  locale: 'id',
  t: (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], idDict);
    return typeof value === 'string' ? value : key;
  },
};

const order = {
  id: 'o1',
  orderNumber: 'HM-0001',
  customerId: 'c1',
  depotId: 'd1',
  status: 'COMPLETED',
  subtotal: 40000,
  deliveryFee: 0,
  discount: 0,
  total: 40000,
  items: [
    { id: 'i1', productId: 'p1', productName: 'Galon 19L', sku: 'G19', unit: 'galon', unitPrice: 20000, quantity: 2, lineTotal: 40000 },
  ],
  history: [],
  reviewed: false,
  isWalkIn: true,
  driverName: null,
  driverPhone: null,
  estimatedArrivalAt: null,
  recipientName: 'Pelanggan walk-in',
  phone: '-',
  addressLine: 'Ambil langsung di depot',
  city: '-',
  province: '-',
  postalCode: null,
  latitude: null,
  longitude: null,
  notes: null,
  createdAt: '2026-07-29T03:00:00.000Z',
  updatedAt: '2026-07-29T03:00:00.000Z',
} as unknown as Order;

function capture(cash?: { cashReceived: number; change: number }, method?: string): string {
  let html = '';
  const write = vi.fn((chunk: string) => {
    html = chunk;
  });
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write, close: vi.fn() },
  } as unknown as Window);
  printReceipt(order, I18N, cash, method);
  return html;
}

describe('printReceipt', () => {
  it('prints the cash tendered and the change for a counter sale', () => {
    const html = capture({ cashReceived: 50000, change: 10000 });
    expect(html).toContain('Tunai');
    expect(html).toContain('Kembali');
    expect(html).toContain('50.000');
    expect(html).toContain('10.000');
  });

  it('leaves the cash rows out of a delivery receipt', () => {
    const html = capture();
    expect(html).not.toContain('Tunai');
    expect(html).not.toContain('Kembali');
  });

  // A QRIS sale has no tender rows at all, so without the method line the struk would not
  // say how it was paid — and would read exactly like an unpaid one.
  it('names the method on a non-cash counter sale', () => {
    const html = capture(undefined, 'QRIS');
    expect(html).toContain('Metode');
    expect(html).toContain('QRIS');
    expect(html).not.toContain('Kembali');
  });

  // The counter screen branches on this: a blocked popup has to be reported to the cashier,
  // who otherwise watches the sale succeed with no struk to hand over.
  it('reports a blocked popup instead of failing silently', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(printReceipt(order, I18N, { cashReceived: 50000, change: 10000 })).toBe(false);
  });

  it('reports success when the print window opened', () => {
    vi.spyOn(window, 'open').mockReturnValue({
      document: { write: vi.fn(), close: vi.fn() },
    } as unknown as Window);
    expect(printReceipt(order, I18N)).toBe(true);
  });
});
