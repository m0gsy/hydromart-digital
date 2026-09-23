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
   * PAY-1: it used to be a live link because the bucket served `payment-proof/*` to anyone —
   * a photo of somebody's banking app, name, account number and balance. The bucket is
   * private now (same recipe as delivery CA-4-49); the string stays what every row holds and
   * nothing renders it. Reads go through `signedUrl`.
   */
  url: string;
  /** Storage key, e.g. 'payment-proof/<uuid>.jpg'. */
  key: string;
}

/**
 * Port for persisting uploaded blobs (payment proofs). The dev adapter writes to local
 * disk; a cloud adapter (S3-compatible via @aws-sdk/client-s3) swaps in behind the same
 * interface. The application never knows which.
 *
 * ponytail: this is the SIXTH copy of this trio — delivery, product, depot, hr,
 * customer and now payment each carry their own port + two adapters, differing only in
 * the key prefix and which ConfigService they read. The ceiling: when a seventh needs
 * one, or when any of the six needs a real change, move it into `@hydromart/platform`
 * with the prefix as a constructor argument. Copying it a sixth time is a smaller diff
 * than refactoring five live services inside a bug fix.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  /** PAY-1: a time-limited GET link for one key. Minted per read, never stored. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /**
   * Delete one object by key. CA-3-07: the payment ROW is a financial record and stays for
   * ten years, but the photo attached to it is a picture of somebody's bank app — a name,
   * an account number, a balance — and it was kept forever because nothing could delete it.
   * Idempotent: a key that is already gone is a success.
   */
  remove(key: string): Promise<void>;
}
