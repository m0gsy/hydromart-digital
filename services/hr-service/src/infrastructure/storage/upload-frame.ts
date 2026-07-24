import { StoragePort } from '../../application/ports/storage.port';

/** Upload a captured JPEG frame; returns the public url, or null when storage is
 *  absent/disabled (the frame still drove the face match, it just isn't persisted). */
export async function uploadFrame(
  storage: StoragePort | undefined,
  body: Buffer,
  keyPrefix: string,
): Promise<string | null> {
  if (!storage) return null;
  const { url } = await storage.put({ body, contentType: 'image/jpeg', ext: 'jpg', keyPrefix });
  return url || null;
}
