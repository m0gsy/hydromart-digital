import { SetMetadata } from '@nestjs/common';

import { Role } from '../../domain/customer/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles (enforced by RolesGuard). Accepts the Role
 * enum or plain role strings, so shared `@hydromart/access` CAPABILITIES tuples
 * (readonly string[]) can be spread directly: `@Roles(...CAPABILITIES.staffAdmin)`.
 */
export const Roles = (...roles: (Role | string)[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
