/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /** Publicly renderable URL (usable directly in <img src>). */
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
}
