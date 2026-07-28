import { timingSafeEqual } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * M12-11: Swagger UI documents every route, DTO and role gate of a service. In
 * development that is the point; on the public internet it is a map for an attacker.
 *
 * Policy, identical in all services:
 *
 *  - not production            -> open, unchanged.
 *  - production + credentials  -> HTTP Basic, credentials from DOCS_USER/DOCS_PASSWORD.
 *  - production, no credentials-> docs are NOT mounted at all.
 *
 * The last case is deliberate: forgetting to set a password must fail closed (no docs)
 * rather than open (public docs). Call this BEFORE SwaggerModule.setup and skip the
 * setup entirely when it returns false.
 */
export function protectDocs(app: INestApplication, path = 'docs'): boolean {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) return true;

  const user = process.env.DOCS_USER ?? '';
  const password = process.env.DOCS_PASSWORD ?? '';
  if (!user || !password) return false;

  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const prefix = `/${path}`;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path !== prefix && !req.path.startsWith(`${prefix}/`)) return next();
    if (matches(req.headers.authorization, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Hydromart docs"').status(401).send('Unauthorized');
    return undefined;
  });
  return true;
}

/** Constant-time compare so the header can't be guessed byte by byte. */
function matches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the length —
  // compare a fixed-size digest-free padding instead by checking length first and
  // returning early only for the (already public) length difference.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
