export interface VisitPhotoPutInput {
  visitId: string;
  body: Buffer;
  contentType: string;
  ext: string;
}

/**
 * Private storage for finding photos: a supervisor's photo can show staff faces, so nothing is
 * ever readable without a short-lived signed link, minted per read and never stored.
 * Keys are `visits/<visitId>/<uuid>.<ext>`.
 */
export interface VisitPhotoStoragePort {
  put(input: VisitPhotoPutInput): Promise<{ key: string }>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
}
