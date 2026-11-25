import { NO_SHOW_REASON } from './no-show';

/** What a courier may pick on the fail screen. */
export const COURIER_FAILURE_REASONS = [
  'ADDRESS_NOT_FOUND',
  'CUSTOMER_REFUSED',
  'GOODS_DAMAGED',
  'CANNOT_CONTACT',
  'OTHER',
] as const;
export type CourierFailureReason = (typeof COURIER_FAILURE_REASONS)[number];

/** Every code a FAILED delivery can carry: the courier's own, plus the two other routes that fail one. */
export const FAILURE_REASON_CODES = [...COURIER_FAILURE_REASONS, 'NO_SHOW', 'DEPOT_CANCELLED'] as const;
export type FailureReasonCode = (typeof FAILURE_REASON_CODES)[number];

/** The text staff read; for the courier's four chips it is exactly what the app has always sent. */
export const FAILURE_REASON_LABELS: Record<FailureReasonCode, string> = {
  ADDRESS_NOT_FOUND: 'Alamat tidak ditemukan',
  CUSTOMER_REFUSED: 'Pelanggan menolak',
  GOODS_DAMAGED: 'Barang rusak',
  CANNOT_CONTACT: 'Pelanggan tidak bisa dihubungi',
  OTHER: 'Lainnya',
  NO_SHOW: NO_SHOW_REASON,
  DEPOT_CANCELLED: 'Dibatalkan depot',
};

/**
 * Rows failed before `failureReasonCode` existed carry only the text. Exact chip text -> its
 * code, the no-show text -> NO_SHOW, anything else (free text) -> OTHER. The AI read's SQL
 * builds the same mapping from `LEGACY_TEXT_CODES`.
 */
export const LEGACY_TEXT_CODES: readonly (readonly [string, FailureReasonCode])[] = [
  ...(['ADDRESS_NOT_FOUND', 'CUSTOMER_REFUSED', 'GOODS_DAMAGED', 'CANNOT_CONTACT'] as const).map(
    (c) => [FAILURE_REASON_LABELS[c], c] as const,
  ),
  [NO_SHOW_REASON, 'NO_SHOW'],
];

export function legacyFailureCode(text: string | null): FailureReasonCode {
  return LEGACY_TEXT_CODES.find(([t]) => t === text)?.[1] ?? 'OTHER';
}
