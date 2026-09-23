/**
 * H-20: what a file actually is, read from its first bytes.
 *
 * Every upload route used to decide from `file.mimetype`, which is the Content-Type the
 * CLIENT typed into the multipart part — a caller who says `image/jpeg` over a .html, an
 * .svg or an executable was believed, and the bytes were then written to a bucket that
 * serves them back to browsers.
 *
 * ponytail: a hand-written signature table, not `file-type` — four formats, four magic
 * numbers, and the package is ESM-only which this CommonJS build cannot import.
 */

export type SniffedType = 'jpg' | 'png' | 'webp' | 'pdf';

/** MIME the bytes say they are, for the four formats the platform accepts. */
export const SNIFFED_MIME: Record<SniffedType, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * CORE-5 — markup a browser would run, found anywhere in the part of the file a sniffer
 * reads.
 *
 * A polyglot is a file with a real JPEG header and an HTML document behind it. The header
 * satisfies a signature check, and a browser that content-sniffs (or any viewer that ignores
 * the served Content-Type) then runs the markup. Checking the first bytes cannot see this,
 * because the point of the attack is that the first bytes are honest.
 *
 * So the first 2KB — the window every sniffing implementation looks at — is refused if it
 * contains an HTML or script opener. This is a filter, not a decoder: it does not prove the
 * file is a valid image, and the storage layer's `Content-Type` plus `nosniff` is still what
 * actually decides how a browser treats it. What it removes is the cheap, common polyglot.
 */
const SNIFFABLE_WINDOW = 2048;
const MARKUP = /<\s*(script|svg|html|!doctype|iframe|embed|object)\b/i;

/** The real type of an uploaded blob, or null if it is none of the four. */
export function sniffFileType(buf: Uint8Array): SniffedType | null {
  if (buf.length < 12) return null;
  const type = signatureOf(buf);
  if (!type) return null;
  // CORE-5: a valid header in front of a document is still a document.
  const head = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, SNIFFABLE_WINDOW));
  if (MARKUP.test(head.toString('latin1'))) return null;
  return type;
}

function signatureOf(buf: Uint8Array): SniffedType | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // RIFF....WEBP — the size word between the two markers is not part of the signature.
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  return null;
}
