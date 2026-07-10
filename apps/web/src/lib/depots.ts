// Pure helpers for the depot admin console. Covered by test/depots.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { DepotPayload } from './types';

export interface DepotForm {
  code: string;
  name: string;
  ownershipType: string;
  address: string;
  city: string;
  province: string;
  lat: string;
  lng: string;
  serviceRadiusKm: string;
  deliveryFee: string;
  minOrderAmount: string;
}

export const EMPTY_DEPOT_FORM: DepotForm = {
  code: '',
  name: '',
  ownershipType: 'HKP',
  address: '',
  city: '',
  province: '',
  lat: '',
  lng: '',
  serviceRadiusKm: '',
  deliveryFee: '',
  minOrderAmount: '',
};

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Coerce the string form into an API payload, or return the first validation
 * error. Required: code/name/address/city/province, ownershipType (WARALABA|HKP),
 * lat/lng (valid ranges), deliveryFee (≥0). Optional: serviceRadiusKm (>0),
 * minOrderAmount (≥0; blank → null clears it).
 */
export function toDepotPayload(form: DepotForm): { ok: true; value: DepotPayload } | { ok: false; error: string } {
  const text = {
    code: form.code.trim(),
    name: form.name.trim(),
    address: form.address.trim(),
    city: form.city.trim(),
    province: form.province.trim(),
  };
  for (const [key, value] of Object.entries(text)) {
    if (!value) return { ok: false, error: `${key} is required.` };
  }
  if (form.ownershipType !== 'WARALABA' && form.ownershipType !== 'HKP') {
    return { ok: false, error: 'Pick an ownership type.' };
  }
  const lat = numOrNull(form.lat);
  if (lat === null || lat < -90 || lat > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  const lng = numOrNull(form.lng);
  if (lng === null || lng < -180 || lng > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  const deliveryFee = numOrNull(form.deliveryFee);
  if (deliveryFee === null || deliveryFee < 0) return { ok: false, error: 'Delivery fee must be 0 or more.' };

  const value: DepotPayload = {
    ...text,
    ownershipType: form.ownershipType,
    lat,
    lng,
    deliveryFee,
    minOrderAmount: numOrNull(form.minOrderAmount),
  };
  const radius = numOrNull(form.serviceRadiusKm);
  if (form.serviceRadiusKm.trim() !== '') {
    if (radius === null || radius <= 0) return { ok: false, error: 'Service radius must be greater than 0.' };
    value.serviceRadiusKm = radius;
  }
  return { ok: true, value };
}
