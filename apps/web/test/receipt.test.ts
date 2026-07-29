// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { printReceipt } from '../src/lib/receipt';
import type { Order } from '../src/lib/types';

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

function capture(cash?: { cashReceived: number; change: number }): string {
  let html = '';
  const write = vi.fn((chunk: string) => {
    html = chunk;
  });
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write, close: vi.fn() },
  } as unknown as Window);
  printReceipt(order, cash);
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
});
