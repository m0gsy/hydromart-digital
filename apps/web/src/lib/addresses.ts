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
