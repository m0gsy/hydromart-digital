import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

import { FACE_BODY_LIMIT } from '../modules/dto/attendance.dto';

/**
 * Routes whose JSON body carries base64 face frames. Everything else keeps a small limit:
 * a 20 MB budget on every HR endpoint would be a free memory-pressure lever.
 *
 * Prefixes, not exact paths — `/employees` covers `/employees/:id/face/enroll`, which is
 * the one enrolment route that cannot be matched by a literal string.
 */
const FACE_ROUTES = ['/api/v1/attendance', '/api/v1/employees'];

/** Everything else. Generous for JSON of any realistic shape, still bounded. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

/**
 * Own the body parsers (main.ts creates the app with `bodyParser: false`).
 *
 * The first matching parser wins — body-parser marks the request as read, so the general
 * parser below skips a body the face parser already consumed.
 */
export function configureBodyLimits(app: INestApplication): void {
  app.use(FACE_ROUTES, json({ limit: FACE_BODY_LIMIT }));
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
