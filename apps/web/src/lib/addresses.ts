import type { Address } from './types';

export interface AddressForm {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  notes: string;
}

/** The address to preselect at checkout: the primary one, else the first, else null. */
export function pickDefaultAddress(addresses: Address[]): Address | null {
  return addresses.find((a) => a.isPrimary) ?? addresses[0] ?? null;
}

/** Maps a saved address onto the checkout form (notes are per-order, never stored). */
export function addressToForm(a: Address): AddressForm {
  return {
    recipientName: a.recipientName,
    phone: a.phone,
    addressLine: a.addressLine,
    city: a.city,
    province: a.province,
    postalCode: a.postalCode ?? '',
    notes: '',
  };
}

// --- Address-book management (the standalone /addresses page) ---
// Client-side pre-validation mirrors customer-service's CreateAddressDto; server stays authority.

export interface AddressBookForm {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: string;
  longitude: string;
}

export const EMPTY_ADDRESS_FORM: AddressBookForm = {
  label: '',
  recipientName: '',
  phone: '',
  addressLine: '',
  city: '',
  province: '',
  postalCode: '',
  latitude: '',
  longitude: '',
};

/** Fills the management form from an existing address (blank string for absent coords). */
export function addressToBookForm(a: Address): AddressBookForm {
  return {
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    addressLine: a.addressLine,
    city: a.city,
    province: a.province,
    postalCode: a.postalCode ?? '',
    latitude: a.latitude === null ? '' : String(a.latitude),
    longitude: a.longitude === null ? '' : String(a.longitude),
  };
}

export interface AddressPayload {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Coerce the string form into an API payload, or return the first validation error.
 * Required: label/recipientName/phone/addressLine/city/province. Optional: postalCode,
 * and latitude/longitude (both must be supplied together and within range — coords are
 * what let an order route to a depot).
 */
export function toAddressPayload(
  form: AddressBookForm,
): { ok: true; value: AddressPayload } | { ok: false; error: string } {
  const text = {
    label: form.label.trim(),
    recipientName: form.recipientName.trim(),
    phone: form.phone.trim(),
    addressLine: form.addressLine.trim(),
    city: form.city.trim(),
    province: form.province.trim(),
  };
  for (const [key, value] of Object.entries(text)) {
    if (!value) return { ok: false, error: `${key} is required.` };
  }

  const value: AddressPayload = { ...text };
  const postalCode = form.postalCode.trim();
  if (postalCode) value.postalCode = postalCode;

  const hasLat = form.latitude.trim() !== '';
  const hasLng = form.longitude.trim() !== '';
  if (hasLat !== hasLng) {
    return { ok: false, error: 'Provide both latitude and longitude, or neither.' };
  }
  if (hasLat) {
    const lat = numOrNull(form.latitude);
    if (lat === null || lat < -90 || lat > 90) {
      return { ok: false, error: 'Latitude must be between -90 and 90.' };
    }
    const lng = numOrNull(form.longitude);
    if (lng === null || lng < -180 || lng > 180) {
      return { ok: false, error: 'Longitude must be between -180 and 180.' };
    }
    value.latitude = lat;
    value.longitude = lng;
  }
  return { ok: true, value };
}
