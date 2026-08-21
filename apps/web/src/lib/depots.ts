import type { Translate } from './addresses';

// Pure helpers for the depot admin console. Covered by test/depots.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { Depot, DepotPayload, NearbyDepot } from './types';

/**
 * A3 — the depot that will actually fulfil an order at this point: the nearest one whose
 * service radius COVERS the point, not merely the nearest one.
 *
 * This mirrors order-service `selectNearestDepot`, which is the authority. The nearby list
 * arrives nearest-first, so the first in-range row is the same depot the server elects.
 *
 * Reading `[0]` instead was wrong in a way that reached the money. Measured against
 * production at Jakarta Pusat: the only candidate came back 14.98 km away with a 3 km
 * radius and `withinService: false` — and the web quoted its Rp1.000 ongkir, priced the
 * whole cart with `cart.view(thatDepot)`, and only failed at submit with
 * `OutOfServiceAreaError`. `withinService` was already on the wire and already read by two
 * other screens; only the one that decides the price ignored it.
 *
 * Radii differ per depot, so "nearest" and "in range" are genuinely different questions:
 * a depot 8 km out with a 20 km radius serves a point that one 3 km out with a 2 km radius
 * does not. That is also why the caller must ask for more than one candidate.
 */
export function servingDepot(nearby: NearbyDepot[] | null | undefined): NearbyDepot | null {
  return nearby?.find((d) => d.withinService) ?? null;
}

/**
 * G3 — the depot an unpinned checkout should start on: the one the home location already
 * resolved to. Returns null when there is none, or when it is no longer on offer — a stale
 * id from an archived depot would otherwise sail past the disabled-submit guard and come
 * back `DepotUnavailableError` after the customer pressed the button.
 *
 * Safe to feed from the home location precisely because `location-selector` now stores only
 * a depot whose radius covers the point (see `servingDepot`).
 */
export function defaultDepotFromLocation(
  homeDepotId: string | null | undefined,
  choices: Depot[] | null | undefined,
): string | null {
  if (!homeDepotId) return null;
  return choices?.some((d) => d.id === homeDepotId) ? homeDepotId : null;
}

/**
 * Which depot the checkout ongkir preview should quote. An address with a map pin is
 * routed by the nearby lookup; one without has no lookup at all and the customer picks
 * the depot by hand — reading only the nearby result showed those orders no ongkir.
 *
 * The radius rule applies to the PINNED path only, and deliberately: the server enforces
 * it there and nowhere else. For an address with no pin it accepts whatever depot was
 * asked for (`resolveDepot`, order.service.ts), because there is no point to measure a
 * radius against. Applying the veto to both paths is what would make A3 and G3 cancel each
 * other — G3 fills the depot in, A3 throws it out, and checkout blocks on a choice the
 * customer never made.
 */
export function resolveDeliveryDepot(
  needsDepotPick: boolean,
  pickedDepotId: string | null,
  depotChoices: Depot[] | null | undefined,
  nearbyDepots: NearbyDepot[] | null | undefined,
): Depot | NearbyDepot | null {
  if (needsDepotPick) return depotChoices?.find((d) => d.id === pickedDepotId) ?? null;
  return servingDepot(nearbyDepots);
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
export function toDepotPayload(
  form: DepotForm,
  t: Translate,
): { ok: true; value: DepotPayload } | { ok: false; error: string } {
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
    return { ok: false, error: t('opsFix.depotForm.ownerRequired') };
  }
  const lat = numOrNull(form.lat);
  if (lat === null || lat < -90 || lat > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  const lng = numOrNull(form.lng);
  if (lng === null || lng < -180 || lng > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  const deliveryFee = numOrNull(form.deliveryFee);
  if (deliveryFee === null || deliveryFee < 0) return { ok: false, error: 'Delivery fee must be 0 or more.' };
  // Digits only (optionally +-prefixed): crm-service enforces exactly this on the message
  // it sends, and the send path is fail-open — a dashed number saved here would mean the
  // depot silently never receives its sales report. Caught at the form, not at 13:00.
  const phone = form.contactPhone.trim() || null;
  if (phone !== null && !/^\+?[0-9]{8,15}$/.test(phone)) {
    return { ok: false, error: t('opsFix.depotForm.whatsappFormat') };
  }

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
    contactPhone: phone,
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
