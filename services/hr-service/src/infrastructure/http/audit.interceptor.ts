import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { AuthenticatedUser, getRequestContext } from '@hydromart/platform';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AuditService } from '../../application/services/audit.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Writes an AuditLog row for every successful mutating HR request (who did what to which
 * entity, from where). Read requests are skipped. The write is fire-and-forget and swallows
 * its own errors, so audit never breaks the request it trails.
 *
 * ponytail: records action/entity/entityId/actor/ip only. before/after field-diffs are left
 * null — capture them per-handler when a screen actually needs the diff, not globally.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(request.method)) {
      return next.handle();
    }

    const user = (request as Request & { user?: AuthenticatedUser }).user;
    const { ipAddress } = getRequestContext(request);
    const { entity, entityId } = this.parseRoute(request.path);

    return next.handle().pipe(
      tap((body) => {
        void this.audit.record({
          actorId: user?.sub ?? null,
          action: request.method,
          entity,
          entityId: entityId ?? this.bodyId(body),
          before: null,
          after: null,
          ip: ipAddress,
        });
      }),
    );
  }

  /** `/api/v1/employees/<uuid>/face/enroll` -> entity "employees", entityId the uuid (if any). */
  private parseRoute(path: string): { entity: string; entityId: string | null } {
    const segments = path.replace(/^\/api(\/v\d+)?\//, '').split('/').filter(Boolean);
    const entity = segments[0] ?? 'unknown';
    const entityId = segments.find((s) => UUID.test(s)) ?? null;
    return { entity, entityId };
  }

  private bodyId(body: unknown): string | null {
    return body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
      ? (body as { id: string }).id
      : null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
