import { describe, expect, it } from 'vitest';

import { podPinHint } from '@/lib/pod-pin';
import type { Delivery } from '@/lib/types';

/**
 * P2-4. For a pinned address the two newest deliveries to THIS pin decide: both handed over
 * more than 150 m away, and within 100 m of each other. 0.002° of latitude is ~222 m.
 */
const pinned = { latitude: -6.9, longitude: 107.6, addressLine: 'Jl. Merdeka 10' };

const delivered = (over: Partial<Delivery> & { id: string }): Delivery =>
  ({
    orderId: 'o',
    orderNumber: 'HM-1',
    driverId: 'drv',
    depotId: 'd-1',
    status: 'DELIVERED',
    destinationAddress: 'Jl. Merdeka 10, Bandung',
    destinationLat: -6.9,
    destinationLng: 107.6,
    lastLat: null,
    lastLng: null,
    lastLocationAt: null,
    assignedAt: '2026-11-01T01:00:00.000Z',
    deliveredAt: '2026-11-01T02:00:00.000Z',
    proof: { latitude: -6.902, longitude: 107.6 } as Delivery['proof'],
    ...over,
  }) as Delivery;
const at = (day: number) => `2026-11-${String(day).padStart(2, '0')}T02:00:00.000Z`;
const proofAt = (latitude: number) => ({ latitude, longitude: 107.6 }) as Delivery['proof'];

describe('podPinHint', () => {
  it('suggests the newest handover when the two newest to this pin agree it is far off', () => {
    const hint = podPinHint(pinned, [
      delivered({ id: 'older', deliveredAt: at(1), proof: proofAt(-6.9021) }),
      delivered({ id: 'newest', deliveredAt: at(9), proof: proofAt(-6.902) }),
    ]);
    expect(hint).toMatchObject({ latitude: -6.902, deliveryId: 'newest' });
    expect(hint!.distanceM).toBeGreaterThan(200);
    expect(hint!.distanceM).toBeLessThan(240);
  });

  it('does not move a pin on one stray fix, nor on two that disagree', () => {
    expect(podPinHint(pinned, [delivered({ id: 'only' })])).toBeNull();
    expect(
      podPinHint(pinned, [
        delivered({ id: 'a', deliveredAt: at(2), proof: proofAt(-6.902) }),
        delivered({ id: 'b', deliveredAt: at(3), proof: proofAt(-6.906) }), // ~440 m apart
      ]),
    ).toBeNull();
  });

  it('says nothing when the newest handover was close, whatever older ones say', () => {
    expect(
      podPinHint(pinned, [
        delivered({ id: 'old1', deliveredAt: at(1) }),
        delivered({ id: 'old2', deliveredAt: at(2) }),
        delivered({ id: 'new', deliveredAt: at(9), proof: proofAt(-6.9003) }),
      ]),
    ).toBeNull();
  });

  it('ignores deliveries to another pin, failed ones, and ones without a proof', () => {
    expect(
      podPinHint(pinned, [
        delivered({ id: 'other', destinationLat: -6.95 }),
        delivered({ id: 'other2', destinationLat: -6.95 }),
        delivered({ id: 'failed', status: 'FAILED' }),
        delivered({ id: 'no-proof', proof: null }),
      ]),
    ).toBeNull();
  });

  it('for an address with no pin, takes the newest proof for an unpinned order to that street', () => {
    const bare = { latitude: null, longitude: null, addressLine: 'Jl. Merdeka 10' };
    const unpinned = { destinationLat: null, destinationLng: null };
    expect(
      podPinHint(bare, [
        delivered({ id: 'd2', ...unpinned }),
        delivered({ id: 'next-door', ...unpinned, destinationAddress: 'Jl. Merdeka 100, Bandung' }),
      ]),
    ).toEqual({ latitude: -6.902, longitude: 107.6, distanceM: null, deliveryId: 'd2' });
    // "Jl. Merdeka 1" is not "Jl. Merdeka 10", and a blank line matches nothing.
    expect(
      podPinHint({ ...bare, addressLine: 'Jl. Merdeka 1' }, [delivered({ id: 'd3', ...unpinned })]),
    ).toBeNull();
    expect(podPinHint({ ...bare, addressLine: '  ' }, [delivered({ id: 'd4', ...unpinned })])).toBeNull();
  });
});
