import type { ProspectStatus } from './types';

export const PROSPECT_CATEGORIES = [
  'KOS',
  'SEKOLAH',
  'PESANTREN',
  'TEMPAT_IBADAH',
  'KLINIK',
  'BENGKEL',
  'SALON',
  'KEBUGARAN',
  'RUMAH_MAKAN',
  'KANTOR_RUKO',
  'LAUNDRY',
  'PENGINAPAN',
  'PABRIK_GUDANG',
] as const;

export const PROSPECT_OUTCOMES = ['MET_DECISION_MAKER', 'LEFT_MATERIAL', 'NOT_THERE', 'REFUSED'] as const;
export const PROSPECT_SOURCES = ['OVERTURE', 'OSM', 'FOURSQUARE_OS', 'INTERNAL', 'FIELD'] as const;
export const DNC_REASONS = ['PROSPECT_REFUSED', 'CUSTOMER_REQUEST', 'WRONG_NUMBER', 'LEGAL', 'OTHER'] as const;

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning';

export const STATUS_TONE: Record<ProspectStatus, BadgeTone> = {
  NEW: 'neutral',
  CONTACTED: 'brand',
  VISITED: 'brand',
  INTERESTED: 'warning',
  CONVERTED: 'success',
  LOST: 'danger',
  DO_NOT_CONTACT: 'danger',
};

/** Translation key for an enum value (the dictionary holds every value the server can send). */
export function labelKey(group: 'status' | 'category' | 'outcome' | 'source' | 'dnc', value: string): string {
  return `opsFix.prospects.${group}.${value}`;
}

/** Google Maps navigation link: navigation only, no Google data is read or stored. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
