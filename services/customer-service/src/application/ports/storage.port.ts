/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /**
   * The object's stable identifier, `${STORAGE_PUBLIC_BASE_URL}/<key>`, absolute.
   *
   * XCUT-1/CUS-1: the photo is often a KTP. It is no longer a live public link — the bucket
   * is private, and the consoles receive a signed link minted per response instead.
   */
  url: string;
  /** Storage key, e.g. 'resellers/<uuid>.png'. */
  key: string;
}

/**
 * Port for persisting uploaded blobs (an agen's registration photo). Same contract as
 * depot/product/auth/delivery-service so the adapters stay interchangeable: the URL that
 * comes back is ABSOLUTE, because it is stored on the record and rendered by consoles
 * that have no base URL of this service to prepend.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  /** A time-limited GET link for one key. Pure local signing — no network call. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** CUS-1: delete one object. Idempotent — a key already gone is a success. */
  remove(key: string): Promise<void>;
}

/** Both adapters build `<base>[/uploads]/resellers/<uuid>.<ext>`; the key starts there. */
export function resellerPhotoKey(url: string | null | undefined): string | null {
  const at = url ? url.indexOf('resellers/') : -1;
  return at === -1 ? null : url!.slice(at);
}
