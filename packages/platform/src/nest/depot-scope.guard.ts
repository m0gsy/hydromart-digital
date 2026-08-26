import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { AuthenticatedUser } from '../http/authenticated-user';
import { IS_PUBLIC_KEY } from './decorators';
import { isDepotLocked, isDepotResolved, isDepotScoped } from './depot-scope';
import { resolveDepotScope } from './depot-scope-resolver';

/**
 * Depot tenant isolation (business rule: a depot's staff must never see another depot's
 * data — "depot A tidak bisa melihat pelanggan depot B").
 *
 * Runs AFTER JwtAuthGuard (which sets `request.user` incl. `depotId` from the token) and
 * RolesGuard. For the depot-locked roles below, any request that carries a `depotId`
 * (query, body, or route param) must target the caller's own assigned depot; otherwise the
 * request is forbidden.
 *
 * Bypass (see any depot + global): HEAD_OFFICE, FINANCE, MARKETING, DIREKTUR, SUPER_ADMIN —
 * and the internal system principal (role SUPER_ADMIN). Locked: STAFF_DEPOT, KEPALA_DEPOT.
 *
 * ponytail: this closes the ENUMERATION vector (list/create endpoints that take depotId as
 * input — the "list depot B's customers" case). By-id endpoints (GET/PATCH /:id) don't carry
 * a depotId, so a locked role could still reach a row of another depot IF it already knows
 * that row's UUID. Those paths must assert `row.depotId === user.depotId` in their own
 * service where the row is loaded. Register this guard as an APP_GUARD after RolesGuard.
 */
@Injectable()
export class DepotScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    if (!user || !isDepotScoped(user.role)) {
      return true;
    }

    // Resolve the caller's depots ONCE and stash them, so assertDepotAccess and
    // depotScopeIds downstream stay synchronous pure functions.
    if (isDepotLocked(user.role)) {
      user.depotIds = user.depotId ? [user.depotId] : [];
    } else if (isDepotResolved(user.role) && !user.depotIds) {
      // Own depot UNION the hierarchy. The token's assignedDepotId was written by
      // auth-service, so counting it needs no lookup and can never widen access — the
      // hierarchy only ever adds depots on top.
      //
      // That is also what the failure mode rests on: if the hierarchy cannot be reached,
      // the caller keeps their own depot and loses the wider set. Narrowing is safe for
      // tenant isolation (it denies, never grants); a wildcard would not be. Only a
      // caller with no depot of their own gets the 503, because for them there is
      // nothing left to serve.
      const own = user.depotId ? [user.depotId] : [];
      let resolved: string[] = [];
      try {
        resolved = (await resolveDepotScope(user.sub, user.role)) ?? [];
      } catch (err) {
        if (own.length === 0) throw err;
      }
      user.depotIds = [...new Set([...own, ...resolved])];
    }

    const requested = DepotScopeGuard.requestedDepotIds(request);
    // Endpoint carries no depot selector — nothing to enforce here (by-id rows are guarded
    // in-service, see class note).
    if (requested.length === 0) {
      return true;
    }

    const allowed = user.depotIds ?? [];
    if (requested.every((depotId) => allowed.includes(depotId))) {
      return true;
    }
    throw new ForbiddenException(
      'Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya.',
    );
  }

  /**
   * EVERY depotId the request carries, across query, body, and route params.
   *
   * Not the first one found: the guard cannot know which source the handler will read, so a
   * request that names two different depots has to satisfy the check for both. Reading only
   * the first (query before params) let any `:depotId` route be waved through by pinning an
   * own-depot `?depotId=` next to it — AUTHZ-A2, and the five findings that were symptoms of
   * it. Repeated query keys arrive as an array, so those count as separate values too, and
   * `depotIds=a,b` (the owner dashboard's batch form) is a selector like any other.
   */
  private static requestedDepotIds(request: Request): string[] {
    const found = new Set<string>();
    const take = (value: unknown): void => {
      if (typeof value === 'string') {
        for (const part of value.split(',')) {
          const id = part.trim();
          if (id.length > 0) found.add(id);
        }
      } else if (Array.isArray(value)) {
        for (const entry of value) take(entry);
      }
    };
    const body = request.body as Record<string, unknown> | undefined;
    for (const key of ['depotId', 'depotIds']) {
      take(request.query?.[key]);
      take(body?.[key]);
      take(request.params?.[key]);
    }
    return [...found];
  }
}
