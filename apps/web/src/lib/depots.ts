// Pure helpers for the depot admin console. Covered by test/depots.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { Depot, DepotPayload, NearbyDepot } from './types';

/**
 * Which depot the checkout ongkir preview should quote. An address with a map pin is
 * routed by the nearby lookup; one without has no lookup at all and the customer picks
 * the depot by hand — reading only the nearby result showed those orders no ongkir.
 */
export function resolveDeliveryDepot(
  needsDepotPick: boolean,
  pickedDepotId: string | null,
  depotChoices: Depot[] | null | undefined,
  nearbyDepots: NearbyDepot[] | null | undefined,
): Depot | NearbyDepot | null {
  if (needsDepotPick) return depotChoices?.find((d) => d.id === pickedDepotId) ?? null;
  return nearbyDepots?.[0] ?? null;
}

export interface DepotForm {
  code: string;
  name: string;
  ownershipType: string;
  /** Franchise owner account id. Required for WARALABA, ignored for HKP. */
  ownerId: string;
  address: string;
  city: string;
  province: string;
  lat: string;
  lng: string;
  serviceRadiusKm: string;
  deliveryFee: string;
  minOrderAmount: string;
  contactPhone: string;
  paymentBankName: string;
  paymentBankAccountNumber: string;
  paymentBankAccountHolder: string;
  paymentQrisImageUrl: string;
}

export const EMPTY_DEPOT_FORM: DepotForm = {
  code: '',
  name: '',
  ownershipType: 'HKP',
  ownerId: '',
  address: '',
  city: '',
  province: '',
  lat: '',
  lng: '',
  serviceRadiusKm: '',
  deliveryFee: '',
  minOrderAmount: '',
  contactPhone: '',
  paymentBankName: '',
  paymentBankAccountNumber: '',
  paymentBankAccountHolder: '',
  paymentQrisImageUrl: '',
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
  // A franchise depot with no owner books its revenue — and HQ's commission — to nobody,
  // silently. depot-service rejects it too; this is the same rule stated early.
  const owner = form.ownerId.trim();
  if (form.ownershipType === 'WARALABA' && !owner) {
    return { ok: false, error: 'A franchise depot must have an owner.' };
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
    // HKP is company-owned: any owner picked before switching type is cleared, not carried.
    ownerId: form.ownershipType === 'WARALABA' ? owner : null,
    lat,
    lng,
    deliveryFee,
    minOrderAmount: numOrNull(form.minOrderAmount),
    // Blank → null clears the field; a depot with no number of its own falls back to the
    // HQ ops number for the SOP sales update rather than being skipped.
    contactPhone: form.contactPhone.trim() || null,
    // Blank → null clears the field (empties allowed; payment info is optional).
    paymentBankName: form.paymentBankName.trim() || null,
    paymentBankAccountNumber: form.paymentBankAccountNumber.trim() || null,
    paymentBankAccountHolder: form.paymentBankAccountHolder.trim() || null,
    paymentQrisImageUrl: form.paymentQrisImageUrl.trim() || null,
  };
  const radius = numOrNull(form.serviceRadiusKm);
  if (form.serviceRadiusKm.trim() !== '') {
    if (radius === null || radius <= 0) return { ok: false, error: 'Service radius must be greater than 0.' };
    value.serviceRadiusKm = radius;
  }
  return { ok: true, value };
}
