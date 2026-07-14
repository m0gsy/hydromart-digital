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
}
