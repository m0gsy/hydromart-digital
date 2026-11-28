import { WA_CONSENT_TEXT_ID } from './wa-consent';

/**
 * HD-12/HD-13: what number 1 answers when a customer writes to it. Free text inside the customer's own
 * 24 h service window, never a template. Indonesian, one short paragraph each.
 */
export const WA_NUMBER_1 = '1';

export const waRegisteredReply = (legalEntity: string): string =>
  `${WA_CONSENT_TEXT_ID.replace('{PT}', legalEntity)}\n\nBalas PROMO bila mau info promo juga.`;

export const WA_REPLY_CODE_INVALID = 'Kode tidak berlaku, minta kode baru di aplikasi atau kasir.';
export const WA_REPLY_STOPPED =
  'Kamu tidak akan menerima pemberitahuan dari Hydromart di nomor ini lagi. Kalau butuh bantuan, kamu tetap bisa menulis di sini. Balas MULAI untuk mengaktifkan lagi.';
export const WA_REPLY_STARTED = 'Oke, pemberitahuan pesanan aktif lagi di nomor ini. Balas STOP kapan saja untuk berhenti.';
export const WA_REPLY_PROMO = 'Oke, kamu juga akan menerima info promo. Balas STOP kapan saja untuk berhenti.';
export const WA_REPLY_OTHER = 'Nomor ini khusus pemberitahuan pesanan. Balas STOP untuk berhenti.';

/** One automatic reply per phone per 24 hours, so a chatty customer is never answered in a loop. */
export const WA_AUTO_REPLY_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * Meta refuses a template parameter that is empty, holds a line break or a tab, or four spaces in a row.
 * A parameter is cleaned to one line; an empty one gets its fallback or, with none, the send is refused
 * BEFORE the cap is reserved (null).
 */
const PARAM_FALLBACK: Record<string, string> = { name: 'Pelanggan' };

export function buildTemplateParams(
  keys: readonly string[],
  vars: Record<string, string>,
): string[] | null {
  const out: string[] = [];
  for (const key of keys) {
    const value = (vars[key] ?? '').replace(/\s+/g, ' ').trim() || PARAM_FALLBACK[key];
    if (!value) return null;
    out.push(value);
  }
  return out;
}

/** Meta error codes that are about load, not about this message: worth retrying although the HTTP status is 4xx. */
export const WA_RETRYABLE_CODES: ReadonlySet<string> = new Set(['130429', '131056', '80007']);
