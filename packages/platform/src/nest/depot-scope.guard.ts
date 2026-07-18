import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { Role } from '../domain/role.enum';
import { AuthenticatedUser } from '../http/authenticated-user';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * Depot tenant isolation (business rule: a depot's staff must never see another depot's
 * data — "depot A tidak bisa melihat pelanggan depot B").
 *
 * Runs AFTER JwtAuthGuard (which sets `request.user` incl. `depotId` from the token) and
 * RolesGuard. For the depot-locked roles below, any request that carries a `depotId`
 * (query, body, or route param) must target the caller's own assigned depot; otherwise the
 * request is forbidden.
 *
 * Bypass (see any depot + global): HEAD_OFFICE, FINANCE, MARKETING, SUPER_ADMIN — and the
 * internal system principal (role SUPER_ADMIN). Locked: DEPOT_OPERATOR, DEPOT_MANAGER.
 *
 * ponytail: this closes the ENUMERATION vector (list/create endpoints that take depotId as
 * input — the "list depot B's customers" case). By-id endpoints (GET/PATCH /:id) don't carry
 * a depotId, so a locked role could still reach a row of another depot IF it already knows
 * that row's UUID. Those paths must assert `row.depotId === user.depotId` in their own
 * service where the row is loaded. Register this guard as an APP_GUARD after RolesGuard.
 */
@Injectable()
export class DepotScopeGuard implements CanActivate {
  private static readonly LOCKED: ReadonlySet<Role> = new Set([
    Role.DEPOT_OPERATOR,
    Role.DEPOT_MANAGER,
  ]);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    // No identity to scope (defensive — JwtAuthGuard already ran on non-public routes).
    if (!user || !DepotScopeGuard.LOCKED.has(user.role)) {
      return true;
    }

    const requested = DepotScopeGuard.requestedDepotId(request);
    // Endpoint carries no depot selector — nothing to enforce here (by-id rows are guarded
    // in-service, see class note).
    if (!requested) {
      return true;
    }

    if (user.depotId && requested === user.depotId) {
      return true;
    }
    throw new ForbiddenException('Akun ini hanya boleh mengakses depotnya sendiri.');
  }

  /** First depotId found across query, body, and route params (string values only). */
  private static requestedDepotId(request: Request): string | null {
    const q = request.query?.['depotId'];
    if (typeof q === 'string' && q.length > 0) return q;
    const b = (request.body as Record<string, unknown> | undefined)?.['depotId'];
    if (typeof b === 'string' && b.length > 0) return b;
    const p = request.params?.['depotId'];
    if (typeof p === 'string' && p.length > 0) return p;
    return null;
  }
}
