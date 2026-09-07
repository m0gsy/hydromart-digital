/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /**
   * The object's stable identifier, shaped `${STORAGE_PUBLIC_BASE_URL}/<key>`.
   *
   * CA-4-49: this used to be a URL that actually resolved, because the bucket served
   * `pod/*` to anyone. It no longer does. The string is kept byte-for-byte because it is
   * what every stored row already holds and what payout-service's receipt allowlist
   * prefix-matches on — but nothing renders it directly any more. Read paths call
   * `signedUrl` and hand the browser a link that expires.
   */
  url: string;
  /** Storage key, e.g. 'pod/<uuid>.jpg'. */
  key: string;
}

/**
 * Port for persisting uploaded blobs (PoD photos/signatures). The dev adapter
 * writes to local disk; a cloud adapter (Cloudflare R2 via @aws-sdk/client-s3)
 * swaps in behind the same interface. The application never knows which.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  /**
   * A time-limited GET link for one key (CA-4-49).
   *
   * The bucket is private, so nothing in it is readable without one of these. Minted per
   * read rather than stored: a link that lives in a database row is a permanent link that
   * merely looks temporary, and a dispute reviewer months later gets a fresh one anyway.
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /**
   * Delete one object by key. The UU PDP retention sweep needs it: deleting the proof row
   * while its photo stayed in the bucket meant the customer's doorstep, their face in the
   * frame and their signature all outlived the record that was supposed to be erased.
   * Idempotent — a key that is already gone is a success.
   */
  remove(key: string): Promise<void>;
}
