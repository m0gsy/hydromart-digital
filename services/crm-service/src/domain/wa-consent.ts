import { randomBytes } from 'node:crypto';

/**
 * HD-12/HD-13: consent per WhatsApp number. The ledger is append-only: the current state of a
 * (phone, number, purpose) is its newest row, and no row at all means "never asked", which is not "refused".
 */

/** Bumped whenever the consent text changes; a web test keeps the dictionary text in line with it. */
export const WA_CONSENT_TEXT_VERSION = '2026-11-29';

/** `{PT}` is the legal entity (WA_LEGAL_ENTITY_NAME) at the time of the consent. */
export const WA_CONSENT_TEXT_ID =
  'Dengan mengirim pesan ini kamu setuju Hydromart ({PT}) mengirim pemberitahuan pesanan ke nomor WhatsApp ini: pesanan dikonfirmasi, kurir berangkat dan tiba, pembayaran, dan pengingat langganan. Balas STOP kapan saja untuk berhenti. Kamu bisa mengubahnya di aplikasi.';

export const WA_CONSENT_SOURCES = [
  'APP',
  'CASHIER_QR',
  'KEYWORD',
  'AIWEB',
  'STAFF_REVOKE',
  'ERASURE',
] as const;
export type WaConsentSource = (typeof WA_CONSENT_SOURCES)[number];
export type WaNumber = '1' | '2';
export type WaPurpose = 'UTILITY' | 'MARKETING';

/** The shape of a ledger row this module reads. `seq` is the order: two rows in one second keep it. */
export interface WaConsentRow {
  seq: bigint;
  phone: string;
  customerId: string | null;
  waNumber: string;
  purpose: string;
  granted: boolean;
}

export type WaConsentState = 'GRANTED' | 'STOPPED' | 'NONE';

/** Newest row per (phone, waNumber, purpose); key is `phone|waNumber|purpose`. */
export function currentConsents(rows: readonly WaConsentRow[]): Map<string, WaConsentRow> {
  const newest = new Map<string, WaConsentRow>();
  for (const row of rows) {
    const key = `${row.phone}|${row.waNumber}|${row.purpose}`;
    const seen = newest.get(key);
    if (!seen || row.seq > seen.seq) newest.set(key, row);
  }
  return newest;
}

/**
 * What number 1 may do with a phone. UTILITY is per number 1 only. MARKETING: a stop on EITHER number counts
 * everywhere (a customer who said STOP to the promo number must not get a promo from the other), and a grant
 * only counts when it was given to number 1 itself.
 */
export function consentState(
  rows: readonly WaConsentRow[],
  phone: string,
  purpose: WaPurpose,
): WaConsentState {
  const current = currentConsents(rows.filter((r) => r.phone === phone));
  const states = [...current.values()].filter((r) => r.purpose === purpose);
  if (purpose === 'MARKETING' && states.some((r) => !r.granted)) return 'STOPPED';
  const onOne = states.find((r) => r.waNumber === '1');
  if (!onOne) return 'NONE';
  return onOne.granted ? 'GRANTED' : 'STOPPED';
}

/** The customer's UTILITY consent on number 1 and the phone it was given from (the newest such row decides). */
export function utilityConsentForCustomer(
  rows: readonly WaConsentRow[],
  customerId: string,
): { state: WaConsentState; phone: string | null } {
  let newest: WaConsentRow | null = null;
  for (const row of rows) {
    if (row.customerId !== customerId || row.purpose !== 'UTILITY' || row.waNumber !== '1') continue;
    if (!newest || row.seq > newest.seq) newest = row;
  }
  if (!newest) return { state: 'NONE', phone: null };
  return { state: newest.granted ? 'GRANTED' : 'STOPPED', phone: newest.phone };
}

export type MarketingBlock = 'NO_CONSENT' | 'STOPPED' | 'PEER_STOP_UNKNOWN';

/**
 * HD-24 will call this before any marketing send. MARKETING must be granted AND the AI web (number 2, which
 * holds the other half of the STOP list) must have synced recently: a stale or absent peer means a STOP we
 * have not heard of may exist, so the message is held (PEER_STOP_UNKNOWN), never sent on hope.
 */
export function canSendMarketing(input: {
  rows: readonly WaConsentRow[];
  phone: string;
  peerLastOkAt: Date | null;
  now: Date;
  maxAgeSeconds: number;
}): { ok: true } | { ok: false; reason: MarketingBlock } {
  const state = consentState(input.rows, input.phone, 'MARKETING');
  if (state === 'STOPPED') return { ok: false, reason: 'STOPPED' };
  if (state === 'NONE') return { ok: false, reason: 'NO_CONSENT' };
  const fresh =
    input.peerLastOkAt !== null &&
    input.now.getTime() - input.peerLastOkAt.getTime() <= input.maxAgeSeconds * 1000;
  return fresh ? { ok: true } : { ok: false, reason: 'PEER_STOP_UNKNOWN' };
}

export type WaKeyword =
  | { kind: 'STOP' }
  | { kind: 'START' }
  | { kind: 'PROMO' }
  | { kind: 'REGISTER'; code: string }
  | { kind: 'OTHER' };

/**
 * An inbound text, trimmed, upper-cased, punctuation stripped, the WHOLE message only: "stop saya" is not STOP
 * (it is ordinary chat that gets the one auto-reply), "DAFTAR AB23CD45" is a registration.
 */
export function parseKeyword(text: string): WaKeyword {
  const t = text
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t === 'STOP' || t === 'BERHENTI' || t === 'UNSUB') return { kind: 'STOP' };
  if (t === 'MULAI') return { kind: 'START' };
  if (t === 'PROMO') return { kind: 'PROMO' };
  const register = /^DAFTAR ([A-Z0-9]{8})$/.exec(t);
  return register ? { kind: 'REGISTER', code: register[1] } : { kind: 'OTHER' };
}

// Crockford-style base32 without the characters people misread: no 0/O, no 1/I. 32 symbols, so a byte & 31 is unbiased.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const WA_OPT_IN_CODE_LENGTH = 8;
/** The code is valid for 30 minutes. */
export const WA_OPT_IN_CODE_TTL_MS = 30 * 60 * 1000;

export function generateOptInCode(): string {
  const bytes = randomBytes(WA_OPT_IN_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte & 31];
  return code;
}
