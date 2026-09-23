/**
 * CRM-8 — every spelling one Indonesian mobile number is stored under here.
 *
 * Rows arrive from pasted campaign lists, imports and services that each normalise
 * differently, so the same person sits under `0812…`, `62812…` and `+62812…`. Erasure
 * matched the one spelling auth-service holds and left the other two. Anything that is not
 * a recognisable Indonesian number is matched exactly as given, and only that way.
 */
export function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/[^\d]/g, '');
  let national: string | null = null;
  if (digits.startsWith('62')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  if (!national || !/^8\d{7,12}$/.test(national)) return [phone];
  return [...new Set([phone, `0${national}`, `62${national}`, `+62${national}`])];
}
