import { SetMetadata } from '@nestjs/common';

import { Role } from '../../domain/customer/role.enum';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles (enforced by RolesGuard). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
