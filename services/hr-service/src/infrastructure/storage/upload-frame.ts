import { Logger } from '@nestjs/common';

import { StoragePort } from '../../application/ports/storage.port';

const logger = new Logger('UploadFrame');

/**
 * Upload a captured JPEG frame; returns the public url, or null when storage is
 * absent/disabled (the frame still drove the face match, it just isn't persisted).
 *
 * Fail-open, deliberately: the photo is evidence kept beside a punch, not the punch itself.
 * Identity was already proven by the face match and the geofence before we get here, so a
 * bucket that is misconfigured, rate-limited or simply down must cost a depot its photos —
 * never a day's attendance for every employee on shift. Failures are logged so the missing
 * frames stay traceable instead of silent.
 */
export async function uploadFrame(
  storage: StoragePort | undefined,
  body: Buffer,
  keyPrefix: string,
): Promise<string | null> {
  if (!storage) return null;
  try {
    const { url } = await storage.put({ body, contentType: 'image/jpeg', ext: 'jpg', keyPrefix });
    return url || null;
  } catch (err) {
    logger.error(
      `Frame upload to ${keyPrefix} failed; continuing without a photo: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
