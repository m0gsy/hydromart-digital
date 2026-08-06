// Public path builders, one file per product area. The gateway strips the first
// segment and forwards the rest to the owning service, so every path is
// `/{segment}/api/v1/...`.
//
// Audit F-15: this used to be a single 1,426-line object literal imported by 232
// files — every route touched it, and every change to any path showed up as a
// conflict in the same file. Splitting it by area changes no path and no call site:
// `endpoints` is still one object, assembled in ./index.ts.

import { identity } from './identity';
import { shop } from './shop';
import { fulfilment } from './fulfilment';
import { money } from './money';
import { depot } from './depot';
import { insight } from './insight';
import { admin } from './admin';
import { hr } from './hr';

/**
 * The single object every screen imports. Assembled from the per-area modules above,
 * so `endpoints.orders.checkout` still resolves exactly as it always has.
 */
export const endpoints = {
  ...identity,
  ...shop,
  ...fulfilment,
  ...money,
  ...depot,
  ...insight,
  ...admin,
  ...hr,
} as const;
