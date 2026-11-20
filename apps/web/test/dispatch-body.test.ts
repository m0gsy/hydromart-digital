/**
 * P1a — one dispatch body for both consoles.
 *
 * The order queue and the order panel each built the courier hand-off by hand, and the
 * queue's copy had lost `customerId` (and the controller dropped the window from both).
 */
import { describe, expect, it } from 'vitest';

import { assignBody } from '@/lib/dispatch';
import type { Order } from '@/lib/types';

const ORDER = {
  id: 'o-1',
  orderNumber: 'HM-0001',
  depotId: 'd-1',
  customerId: 'c-1',
  phone: '081234567890',
  addressLine: 'Jl. Mawar 1',
  city: 'Jakarta',
  latitude: -6.2,
  longitude: 106.8,
  notes: 'Pagar hijau',
  deliveryWindow: 'Besok, 09:00-12:00',
  items: [{ productName: 'Galon 19L', quantity: 2 }],
} as unknown as Order;

describe('assignBody', () => {
  it('hands the courier the customer, the window and the landmark', () => {
    expect(assignBody(ORDER, 'drv-1', { fullName: 'Kurir Satu', phone: '0813' })).toEqual({
      orderId: 'o-1',
      orderNumber: 'HM-0001',
      driverId: 'drv-1',
      driverName: 'Kurir Satu',
      driverPhone: '0813',
      depotId: 'd-1',
      destinationAddress: 'Jl. Mawar 1, Jakarta',
      destinationLat: -6.2,
      destinationLng: 106.8,
      recipientPhone: '081234567890',
      customerId: 'c-1',
      items: [{ name: 'Galon 19L', qty: 2 }],
      notes: 'Pagar hijau',
      deliveryWindow: 'Besok, 09:00-12:00',
    });
  });

  it('leaves out what the order and the courier do not have, rather than sending null', () => {
    const bare = {
      ...ORDER,
      depotId: null,
      latitude: null,
      longitude: null,
      notes: null,
      deliveryWindow: null,
    } as unknown as Order;
    const body = assignBody({ ...bare, city: '' } as Order, 'drv-1', undefined);
    expect(body.destinationAddress).toBe('Jl. Mawar 1');
    for (const key of [
      'driverName',
      'driverPhone',
      'depotId',
      'destinationLat',
      'destinationLng',
      'notes',
      'deliveryWindow',
    ] as const) {
      expect(body[key], key).toBeUndefined();
    }
  });
});
