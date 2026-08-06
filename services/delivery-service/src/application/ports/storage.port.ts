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
   * Delete one object by key. The UU PDP retention sweep needs it: deleting the proof row
   * while its photo stayed in the bucket meant the customer's doorstep, their face in the
   * frame and their signature all outlived the record that was supposed to be erased.
   * Idempotent — a key that is already gone is a success.
   */
  remove(key: string): Promise<void>;
}
