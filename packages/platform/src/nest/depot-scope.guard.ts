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

    const requested = DepotScopeGuard.requestedDepotId(request);
    // Endpoint carries no depot selector — nothing to enforce here (by-id rows are guarded
    // in-service, see class note).
    if (!requested) {
      return true;
    }

    if ((user.depotIds ?? []).includes(requested)) {
      return true;
    }
    throw new ForbiddenException(
      'Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya.',
    );
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
