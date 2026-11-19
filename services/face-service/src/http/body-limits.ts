import type { INestApplication } from '@nestjs/common';
import { json, raw } from 'express';

/** The largest JPEG the embed route takes. A phone selfie is a fraction of this. */
export const MAX_JPEG_BYTES = 2 * 1024 * 1024;
export const EMBED_PATH = '/api/v1/internal/embed';

/**
 * Own the body parsers (main.ts creates the app with `bodyParser: false`): the embed route
 * takes the JPEG as the raw body, everything else a small JSON one. The first matching parser
 * wins; a body it read is skipped by the next.
 */
export function configureBodyLimits(app: INestApplication): void {
  app.use(EMBED_PATH, raw({ type: ['image/jpeg', 'application/octet-stream'], limit: MAX_JPEG_BYTES }));
  app.use(json({ limit: 16 * 1024 }));
}
