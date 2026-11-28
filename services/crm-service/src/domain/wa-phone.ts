/**
 * HD-12/HD-13: the one spelling a WhatsApp number is stored under in the consent ledger: digits only,
 * `62...`, no plus. It is what Meta's `wa_id` already looks like, so an inbound message and a number typed
 * at a counter meet on the same string. `phoneVariants` (next to this) is for matching OLD rows written under
 * other spellings; this is for what is written from now on.
 *
 * Anything that is not a recognisable Indonesian mobile number returns null: a consent row for a string
 * nobody can message would be worse than no row.
 */
export function normalizeWaPhone(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  let national: string | null = null;
  if (digits.startsWith('62')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  return national && /^8\d{7,12}$/.test(national) ? `62${national}` : null;
}
