export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface StoragePutInput {
  body: Buffer;
  contentType: string;
  ext: string;
  /** Key folder, e.g. 'hr/attendance' or 'hr/faces'. */
  keyPrefix: string;
}

export interface StoragePutResult {
  /** Publicly renderable URL, or '' when storage is disabled (no persistence). */
  url: string;
  key: string;
}

/**
 * Persists HR photo blobs (attendance frames, enrolled face source photos). S3 adapter in
 * prod; a disabled no-op in dev/test (frames still drive the face match, just not stored).
 */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  /**
   * Read an object back by key (SEC-01).
   *
   * HR documents — KTP scans, contracts, payslips — used to be handed to the browser as a
   * permanent unsigned URL, so anyone who ever saw one kept it for good and no login was
   * involved in opening it. The bytes leave through hr-service instead, behind the same
   * capability and depot check as the row. Throws when the object is gone or storage is
   * not configured: an unreadable document must not look like an empty one.
   */
  getObject(key: string): Promise<{ body: Buffer; contentType: string | null }>;
  /**
   * Remove an object by key. Needed by the document retention purge: deleting the row alone
   * would leave a KTP scan sitting in the bucket, which is not erasure in any sense UU 27/2022
   * would accept. Must be idempotent — a key that is already gone is a success, not an error.
   */
  remove(key: string): Promise<void>;
}
