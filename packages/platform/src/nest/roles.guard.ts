import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { can, type Capability } from '@hydromart/access';

import { AuthenticatedUser } from '../http/authenticated-user';
import { CAPABILITY_KEY, IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Enforces @Can(capability) and @Roles(...). No decorator ⇒ no restriction. Runs after
 * JwtAuthGuard.
 *
 * @Can resolves against the live capability map, so a super admin's matrix edit takes
 * effect without a deploy. @Roles keeps its literal list, for the routes where the set
 * is a fact rather than a policy (customer-only, service-to-service).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public() routes carry no identity (JwtAuthGuard skipped them), so a class-level
    // @Roles() inherited by a public handler could only ever 403. Those routes carry
    // their own auth (e.g. InternalAuthGuard on the service-to-service pushes).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const { capability, roles } = this.required(context);
    if (!capability && (!roles || roles.length === 0)) {
      return true;
    }
    const user = context.switchToHttp().getRequest<Request>().user as AuthenticatedUser | undefined;
    if (!user) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    // `can()` already short-circuits SUPER_ADMIN; the @Roles path repeats the bypass so
    // the two branches cannot drift, and so it survives an empty literal list.
    const allowed = capability
      ? can(capability, user.role)
      : user.role === 'SUPER_ADMIN' || (roles ?? []).includes(user.role);
    if (!allowed) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return true;
  }

  /**
   * Resolve what this route requires, HANDLER FIRST — not key first.
   *
   * getAllAndOverride() per key would let a class-level @Can shadow a method-level
   * @Roles (or the reverse), silently applying the wrong rule to the narrower
   * decorator. So: if the handler declares either one, the handler decides outright,
   * and only an undecorated handler inherits from its class.
   */
  private required(context: ExecutionContext): {
    capability?: Capability;
    roles?: readonly string[];
  } {
    const handler = context.getHandler();
    const handlerCapability = this.reflector.get<Capability | undefined>(CAPABILITY_KEY, handler);
    const handlerRoles = this.reflector.get<readonly string[] | undefined>(ROLES_KEY, handler);
    if (handlerCapability || (handlerRoles && handlerRoles.length > 0)) {
      return { capability: handlerCapability, roles: handlerRoles };
    }
    const cls = context.getClass();
    return {
      capability: this.reflector.get<Capability | undefined>(CAPABILITY_KEY, cls),
      roles: this.reflector.get<readonly string[] | undefined>(ROLES_KEY, cls),
    };
  }
}
