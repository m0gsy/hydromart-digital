import type { Translate } from './addresses';

// Pure helpers for the depot admin console. Covered by test/depots.test.ts.
// Client-side pre-validation mirrors depot-service's DTO; the server stays authority.

import type { DepotOwnerShare, DepotPayload, NearbyDepot } from './types';

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

/** One owner row in the depot form: the share is typed, so it stays a string until validated. */
export interface OwnerRowForm {
  ownerId: string;
  sharePct: string;
  isPrimary: boolean;
}

export const blankOwnerRow = (isPrimary = false): OwnerRowForm => ({
  ownerId: '',
  sharePct: '',
  isPrimary,
});

/** The form rows for a saved depot; a depot read from an older server has only `ownerId`. */
export function ownerRowsFromDepot(d: {
  ownerId?: string | null;
  owners?: { ownerId: string; sharePct: number; isPrimary: boolean }[];
}): OwnerRowForm[] {
  if (d.owners && d.owners.length > 0) {
    return d.owners.map((o) => ({
      ownerId: o.ownerId,
      sharePct: String(o.sharePct),
      isPrimary: o.isPrimary,
    }));
  }
  return d.ownerId ? [{ ownerId: d.ownerId, sharePct: '100', isPrimary: true }] : [{ ...blankOwnerRow(true), sharePct: '100' }];
}

/** Account ids that own a depot record, from the owner list or the mirrored primary. */
export function depotOwnerIds(d: {
  ownerId?: string | null;
  owners?: { ownerId: string }[];
}): string[] {
  if (d.owners && d.owners.length > 0) return d.owners.map((o) => o.ownerId);
  return d.ownerId ? [d.ownerId] : [];
}

export interface DepotForm {
  code: string;
  name: string;
  ownershipType: string;
  /** Franchise owners and their shares. At least one for WARALABA, ignored for HKP. */
  owners: OwnerRowForm[];
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
  owners: [{ ownerId: '', sharePct: '100', isPrimary: true }],
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
 * The ownership half of the depot form: its type and owners, or the first error. Also what
 * head office's owners form sends on its own (PUT …/owners): the rest of the depot is the
 * manager's to edit.
 */
export function toOwnershipPayload(
  ownershipType: string,
  ownerRows: OwnerRowForm[],
  t: Translate,
): { ok: true; value: { ownershipType: string; owners: DepotOwnerShare[] } } | { ok: false; error: string } {
  if (ownershipType !== 'WARALABA' && ownershipType !== 'HKP') {
    return { ok: false, error: t('opsFix.depotForm.pickOwnership') };
  }
  // A franchise depot with no owner books its revenue — and HQ's commission — to nobody,
  // silently. depot-service rejects it too; this is the same rule stated early.
  let owners: DepotOwnerShare[] = [];
  if (ownershipType === 'WARALABA') {
    const rows = ownerRows.filter((r) => r.ownerId.trim() !== '');
    if (rows.length === 0) return { ok: false, error: t('opsFix.depotForm.ownerRequired') };
    if (new Set(rows.map((r) => r.ownerId)).size !== rows.length) {
      return { ok: false, error: t('opsFix.depotForm.ownersInvalid') };
    }
    // A lone owner takes everything: the share and the primary flag are not theirs to get wrong.
    const parsed = rows.map((r) => ({
      ownerId: r.ownerId,
      sharePct: rows.length === 1 ? 100 : (numOrNull(r.sharePct) ?? NaN),
      isPrimary: rows.length === 1 ? true : r.isPrimary,
    }));
    // Hundredths of a percent, as depot-service compares them, so 33.33 x 3 cannot drift.
    if (parsed.some((o) => !(o.sharePct > 0) || o.sharePct > 100 || Math.abs(o.sharePct * 100 - Math.round(o.sharePct * 100)) > 1e-6)) {
      return { ok: false, error: t('opsFix.depotForm.ownersInvalid') };
    }
    if (parsed.reduce((sum, o) => sum + Math.round(o.sharePct * 100), 0) !== 10_000) {
      return { ok: false, error: t('opsFix.depotForm.ownersInvalid') };
    }
    if (parsed.filter((o) => o.isPrimary).length !== 1) {
      return { ok: false, error: t('opsFix.depotForm.ownersInvalid') };
    }
    owners = parsed;
  }
  return { ok: true, value: { ownershipType, owners } };
}

/**
 * The payload minus who owns the depot: what an editor that may not change ownership sends. A
 * resend of what it read could still differ from what is stored (a legacy owner on an HKP
 * depot) and be refused as an ownership change — on a save that only fixed an address.
 */
export function withoutOwnership(
  payload: DepotPayload,
): Omit<DepotPayload, 'ownershipType' | 'ownerId' | 'owners'> {
  const rest: Partial<DepotPayload> = { ...payload };
  delete rest.ownershipType;
  delete rest.ownerId;
  delete rest.owners;
  return rest as Omit<DepotPayload, 'ownershipType' | 'ownerId' | 'owners'>;
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
    if (!value) return { ok: false, error: t('opsFix.depotForm.fieldRequired', { field: t(`opsFix.depotForm.field.${key}`) }) };
  }
  const ownership = toOwnershipPayload(form.ownershipType, form.owners, t);
  if (!ownership.ok) return ownership;
  const { owners } = ownership.value;
  const lat = numOrNull(form.lat);
  if (lat === null || lat < -90 || lat > 90) return { ok: false, error: t('opsFix.depotForm.latRange') };
  const lng = numOrNull(form.lng);
  if (lng === null || lng < -180 || lng > 180) return { ok: false, error: t('opsFix.depotForm.lngRange') };
  const deliveryFee = numOrNull(form.deliveryFee);
  if (deliveryFee === null || deliveryFee < 0) return { ok: false, error: t('opsFix.depotForm.feeMin') };
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
    ownerId: owners.find((o) => o.isPrimary)?.ownerId ?? null,
    owners,
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
    if (radius === null || radius <= 0) return { ok: false, error: t('opsFix.depotForm.radiusMin') };
    value.serviceRadiusKm = radius;
  }
  return { ok: true, value };
}
