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
  /**
   * CA-3-52: `null` clears it. `undefined` would omit the key and leave the stored
   * landmark in place, which is how a patokan somebody deleted kept reaching the courier.
   */
  notes?: string | null;
}

/**
 * A typed coordinate, or null for anything that is not one — blank included.
 *
 * Exported since the checkout sheet grew its own manual lat/lng fields: `Number('')` is 0,
 * and 0,0 is a real place in the Atlantic that an emptied field must never quietly become.
 */
export function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/**
 * A coordinate PAIR out of whatever was pasted: "-6.9147, 107.6098", or a Google Maps link that
 * carries one. "!3d…!4d…" is the dropped pin and wins over "@…", which is only where the map
 * was looking. Short links (maps.app.goo.gl) carry no coordinates and give null, as does 0,0.
 */
export function parseLatLngPair(text: string): { latitude: number; longitude: number } | null {
  let t = text;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* a stray % — read the text as it is */
  }
  // After decoding: every dash a phone or Word puts in is a minus ("–6.9" must not read as
  // +6.9), and ",+" is how a search link encodes the space.
  t = t.replace(/[−–—]/g, '-').replace(/,\+/g, ', ');
  const m =
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t) ??
    // Not in the middle of a longer number: "107.6098, -6.9147" (lng first) must not read
    // as latitude 7.6098.
    /(?<![\d.])(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})/.exec(t);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return latitude === 0 && longitude === 0 ? null : { latitude, longitude };
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
  /*
   * CA-3-52 — clearing the landmark never deleted it.
   *
   * `if (notes)` omitted the key entirely when the box was emptied, and a PATCH without
   * the field leaves the column alone. So a customer who removed a wrong or outdated
   * patokan saw it disappear from the form and the courier kept being sent to it. Sent
   * as `null` now, which is what the write-back at checkout already does.
   */
  const notes = form.notes.trim();
  value.notes = notes || null;

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
