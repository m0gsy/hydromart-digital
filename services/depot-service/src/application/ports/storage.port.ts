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
  /** Storage key, e.g. 'qris/<uuid>.png'. */
  key: string;
}

/**
 * Port for persisting uploaded blobs (a depot's static QRIS image). Same contract as
 * product/auth/delivery-service so the adapters stay interchangeable: the URL that comes
 * back is ABSOLUTE, because it is rendered straight into the customer's payment screen
 * where no console base URL exists to prepend.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
}
