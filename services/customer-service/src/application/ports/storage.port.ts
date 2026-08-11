/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /** Publicly renderable URL (usable directly in <img src>, no base to prepend). */
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
}
