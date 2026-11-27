/**
 * An Indonesian phone number (08..., 628..., +628..., spaces/dashes/brackets allowed) in E.164
 * (+62...), or null when it cannot be read. Accepts landlines (businesses have them); `mobile`
 * says whether it is a +628 number an account could be signed up with.
 *
 * Same digits rule as depot-service `toE164` (franchise applications); the two older private
 * copies (that one and auth-service PhoneNumber) are deliberately left alone.
 */
export function normalizeIdPhone(raw: unknown): { e164: string; mobile: boolean } | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^0-9]/g, '');
  const national = digits.startsWith('62')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : null;
  if (national === null || national.startsWith('0')) return null;
  if (national.length < 8 || national.length > 13) return null;
  const e164 = `+62${national}`;
  return { e164, mobile: /^\+628\d{7,11}$/.test(e164) };
}
