import { maskPhone } from './log-redact';

/*
 * The rule the repo already had, now where every service can reach it.
 *
 * It lived as a private static on auth-service's OtpService, which is why two other
 * services logged phone numbers whole — they had no copy, and nowhere to import one from.
 * Head and tail survive so the line can still tell one failed notification from another,
 * and show what was wrong with a number that would not dial; the subscriber does not.
 */
describe('maskPhone', () => {
  it('keeps the country code and the last three digits, and nothing else', () => {
    expect(maskPhone('+6281234567890')).toBe('+6281******890');
  });

  it('leaves separators alone, so a malformed number still reads as malformed', () => {
    expect(maskPhone('0812-3456-789')).toBe('0812-*****789');
  });

  // Below eight characters there is no middle to hide, and starring the whole thing would
  // throw away the only diagnostic the line carries.
  it('leaves a number too short to mask alone', () => {
    expect(maskPhone('+62812')).toBe('+62812');
    expect(maskPhone('')).toBe('');
  });

  it('never leaves the original middle in its output', () => {
    for (const n of ['+628111111111', '081298765432', '+62 812 3456 7890']) {
      expect(maskPhone(n)).not.toContain(n.slice(5, -3));
    }
  });

  // The output is the same length as the input: a mask that changed the length would make
  // "this number is the wrong length" unreadable, which is what these lines report.
  it('preserves the length', () => {
    expect(maskPhone('+6281234567890')).toHaveLength('+6281234567890'.length);
  });
});
