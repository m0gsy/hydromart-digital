import type { TVars } from './locale-context';

/** The translator, passed in: a pure validator that produces COPY cannot call a hook. */
export type Translate = (key: string, vars?: TVars) => string;

import type { Address } from './types';

/*
 * No province, no postcode.
 *
 * A courier here reads the street line, the city, the landmark ("patokan") and a map
 * pin. Province and postcode were two required fields that no delivery, no depot match
 * and no price ever consulted — they were friction at the one screen a customer can't
 * skip. The columns stay in the database for the addresses already written.
 */
export interface AddressForm {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
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
    // Prefill the per-order driver note from the saved landmark; the customer can still edit it.
    notes: a.notes ?? '',
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
  latitude: string;
  longitude: string;
  notes: string;
}

export const EMPTY_ADDRESS_FORM: AddressBookForm = {
  label: '',
  recipientName: '',
  phone: '',
  addressLine: '',
  city: '',
  latitude: '',
  longitude: '',
  notes: '',
};

/** Fills the management form from an existing address (blank string for absent coords). */
export function addressToBookForm(a: Address): AddressBookForm {
  return {
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    addressLine: a.addressLine,
    city: a.city,
    latitude: a.latitude === null ? '' : String(a.latitude),
    longitude: a.longitude === null ? '' : String(a.longitude),
    notes: a.notes ?? '',
  };
}

export interface AddressPayload {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Coerce the string form into an API payload, or return the first validation error.
 * Required: label/recipientName/phone/addressLine/city. Optional: notes/patokan and
 * latitude/longitude (both must be supplied together and within range — coords are
 * what let an order route to a depot).
 */
export function toAddressPayload(
  form: AddressBookForm,
  t: Translate,
): { ok: true; value: AddressPayload } | { ok: false; error: string } {
  const text = {
    label: form.label.trim(),
    recipientName: form.recipientName.trim(),
    phone: form.phone.trim(),
    addressLine: form.addressLine.trim(),
    city: form.city.trim(),
  };
  // E6: this used to answer `${key} is required.` — the field's CODE name, in English,
  // shown to a customer saving an address. The form marks its required fields already,
  // so one sentence in their language beats a developer's variable name.
  if (Object.values(text).some((value) => !value)) {
    return { ok: false, error: t('errors.address.required') };
  }

  const value: AddressPayload = { ...text };
  const notes = form.notes.trim();
  if (notes) value.notes = notes;

  // The pin is REQUIRED: depot routing is by distance, so an address without one cannot
  // be matched to any depot. It used to save fine and then fail at checkout, which reads
  // as a broken order rather than an incomplete address. Mirrors CreateAddressDto.
  if (form.latitude.trim() === '' || form.longitude.trim() === '') {
    return { ok: false, error: t('customerFix.address.pinRequired') };
  }
  const lat = numOrNull(form.latitude);
  if (lat === null || lat < -90 || lat > 90) {
    return { ok: false, error: t('errors.address.latitudeRange') };
  }
  const lng = numOrNull(form.longitude);
  if (lng === null || lng < -180 || lng > 180) {
    return { ok: false, error: t('errors.address.longitudeRange') };
  }
  value.latitude = lat;
  value.longitude = lng;
  return { ok: true, value };
}
