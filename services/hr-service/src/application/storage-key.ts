/**
 * The object key behind a stored HR photo value, or null when it names nothing this
 * deployment wrote.
 *
 * Two shapes are stored: a bare key (`hr/attendance/<uuid>.jpg`, what `upload-frame.ts`
 * writes) and a full URL ending in one. The key is the trailing `hr/<folder>/<file>`; an
 * absolute URL to another host is still reduced to it, because deleting OUR key of the
 * same name is the only thing this is ever used for — never a fetch.
 */
export function hrStorageKey(stored: string | null | undefined): string | null {
  if (!stored || stored.includes('..')) return null;
  const match = /(?:^|\/)(hr\/[a-z0-9-]+\/[^/?#]+)$/i.exec(stored);
  return match ? match[1] : null;
}
