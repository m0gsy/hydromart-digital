/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /**
   * The object's stable identifier, `${STORAGE_PUBLIC_BASE_URL}/<key>`.
   *
   * AUTH-1: this used to be a permanent public link to a person's face, repeated in every
   * profile response. The bucket is private now (delivery CA-4-49 recipe); the string is
   * what rows hold, and reads go through `signedUrl`.
   */
  url: string;
  /** Storage key, e.g. 'avatars/<uuid>.jpg'. */
  key: string;
}

/**
 * Port for persisting uploaded blobs (customer avatar images). The dev adapter
 * writes to local disk; a cloud adapter (Cloudflare R2 via @aws-sdk/client-s3)
 * swaps in behind the same interface. The application never knows which.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  /** AUTH-1: a time-limited GET link for one key. Minted per read, never stored. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** AUTH-2: delete one object. Idempotent — a key already gone is a success. */
  remove(key: string): Promise<void>;
}

/** Both adapters build `<base>[/uploads]/avatars/<uuid>.<ext>`; the key starts there. */
export function avatarKeyFromUrl(url: string | null): string | null {
  const at = url ? url.indexOf('avatars/') : -1;
  return at === -1 ? null : url!.slice(at);
}
