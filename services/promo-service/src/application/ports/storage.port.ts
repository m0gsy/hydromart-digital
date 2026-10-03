/** Input for a single blob write. `contentType` is used by cloud adapters to set
 *  the response Content-Type; the local-disk adapter only needs `ext`. */
export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
}

export interface StoragePutResult {
  /** The object's stable identifier, `${STORAGE_PUBLIC_BASE_URL}/<key>`, absolute — stored
   *  on the promotion record and rendered by the customer Home page directly. */
  url: string;
  /** Storage key, e.g. 'promotions/<uuid>.png'. */
  key: string;
}

/**
 * Port for persisting an uploaded promo banner image — item 8 of the 2026 evaluation
 * list: the admin console had a plain "image URL" text field, relying on an externally
 * hosted link that could disappear or be swapped by whoever controlled it. Same contract
 * as customer/depot/product/auth-service so the adapters stay interchangeable.
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
}
