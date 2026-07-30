import { ForbiddenException } from '@nestjs/common';

import { can, type Capability } from '@hydromart/access';

import { AuthenticatedUser } from '../http/authenticated-user';

/**
 * The imperative twin of `@Can`, for a decision taken INSIDE a handler rather than on
 * the route — "writing a per-depot setting needs depotAdmin, writing the GLOBAL default
 * needs more". A route decorator cannot express that, because the answer depends on the
 * request body.
 *
 * Reads the same live map as the guard, so the two can never disagree.
 */
export function assertCapability(
  user: Pick<AuthenticatedUser, 'role'> | undefined,
  capability: Capability,
): void {
  if (!user || !can(capability, user.role)) {
    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
