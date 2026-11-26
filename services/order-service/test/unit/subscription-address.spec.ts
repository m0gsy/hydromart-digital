import type { DepotLocation } from '../../src/application/ports/depot-directory.port';
import type { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import { addressToDeliver, routedDepot, sameSnapshot } from '../../src/domain/subscription-address';

/** The one rule for "where does this plan go": the sweep writes it, the reminder filter only reads it (HD-14). */
const depot = (id: string, lat: number): DepotLocation => ({ id, lat, lng: 106.8, serviceRadiusKm: 5, deliveryFee: 0, minOrderAmount: null });
const A = depot('a', -6.2);
const B = depot('b', -7.5);
const addr = (over: Partial<DeliveryAddressSnapshot> = {}): DeliveryAddressSnapshot => ({
  recipientName: 'Budi', phone: '08', addressLine: 'Jl 1', city: 'X', province: null, postalCode: null, latitude: -6.2, longitude: 106.8, notes: null, ...over,
});

describe('addressToDeliver', () => {
  const snap = addr();
  it('keeps the snapshot when the plan follows nothing, nothing is readable, or nothing changed', () => {
    expect(addressToDeliver(false, snap, addr({ addressLine: 'Baru' }), [A])).toBe(snap);
    expect(addressToDeliver(true, snap, null, [A])).toBe(snap);
    expect(addressToDeliver(true, snap, addr({ addressLine: 'Baru' }), null)).toBe(snap);
    expect(addressToDeliver(true, snap, addr({ addressLine: 'Baru' }), [])).toBe(snap);
    expect(addressToDeliver(true, snap, addr(), [A])).toBe(snap);
    expect(addressToDeliver(true, snap, addr({ latitude: null, longitude: null, addressLine: 'Baru' }), [A])).toBe(snap);
  });
  it('follows an edit the same depot still serves, never another depot, nor out of every area', () => {
    const edit = addr({ addressLine: 'Baru', latitude: -6.21 });
    expect(addressToDeliver(true, snap, edit, [A, B])).toBe(edit);
    expect(addressToDeliver(true, snap, addr({ latitude: -7.5 }), [A, B])).toBe(snap);
    expect(addressToDeliver(true, snap, addr({ latitude: 0, longitude: 0 }), [A, B])).toBe(snap);
  });
  it('lets a plan with no pin of its own take a pinned edit', () => {
    const noPin = addr({ latitude: null, longitude: null });
    const edit = addr({ latitude: -6.2 });
    expect(addressToDeliver(true, noPin, edit, [A])).toBe(edit);
  });
});

describe('routedDepot and sameSnapshot', () => {
  it('routes by pin, and nothing without a pin or depots', () => {
    expect(routedDepot(addr(), [A, B])?.id).toBe('a');
    expect(routedDepot(addr({ latitude: null }), [A])).toBeNull();
    expect(routedDepot(addr(), null)).toBeNull();
    expect(routedDepot(addr(), [])).toBeNull();
  });
  it('compares null and undefined as equal', () => {
    expect(sameSnapshot(addr(), { ...addr(), notes: undefined as never })).toBe(true);
    expect(sameSnapshot(addr(), addr({ notes: 'x' }))).toBe(false);
  });
});
