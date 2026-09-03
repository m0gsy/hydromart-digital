import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import { AuditEvent } from './audit-trail';

/**
 * Where a recorded mutation goes. Two implementations exist and they are different on
 * purpose: auth-service owns the audit table, so it writes straight to it; every other
 * service posts to auth-service's internal ingest via `recordAuditEvent`.
 *
 * Never throws — see the class note.
 */
export interface AuditMutationSink {
  record(event: AuditEvent): Promise<void>;
}

export const AUDIT_MUTATION_SINK = 'AUDIT_MUTATION_SINK';

/** Body/param names whose VALUE must never reach the trail, matched case-insensitively. */
const SECRET_KEY = /secret|token|password|apikey|api_key|signature|otp|pin/i;

/** A path segment that identifies a row rather than naming a route. */
function isIdSegment(s: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
    /^\d+$/.test(s) ||
    /^c[a-z0-9]{20,}$/i.test(s) // cuid
  );
}

/**
 * `POST /api/v1/api-keys/<uuid>/rotate` -> `{ slug: 'api-keys.rotate', target: '<uuid>' }`.
 *
 * The last non-id segment of a sub-route IS the verb the operator pressed ("rotate",
 * "replay", "resolve"), which is more use in a trail than the HTTP method. When there is
 * no such segment the method supplies the word instead.
 */
export function describeRoute(
  method: string,
  urlPath: string,
): { action: string; target?: string } {
  const segments = urlPath
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .filter((s) => s !== 'api' && !/^v\d+$/.test(s));
  const idAt = segments.findIndex(isIdSegment);
  const target = idAt === -1 ? undefined : segments[idAt];
  const named = segments.filter((s) => !isIdSegment(s));
  const verbByMethod: Record<string, string> = {
    POST: 'created',
    PUT: 'changed',
    PATCH: 'changed',
    DELETE: 'deleted',
  };
  // A trailing named segment that sits AFTER an id is the operator's verb; otherwise the
  // method is all we have. The id is what makes it a verb rather than a noun:
  // `/feature-flags/express-fee` names a row, `/api-keys/<id>/rotate` names an action.
  const trailingIsVerb =
    idAt !== -1 && named.length > 1 && segments.lastIndexOf(named[named.length - 1]) > idAt;
  const action = trailingIsVerb
    ? named.join('.')
    : [...named, verbByMethod[method.toUpperCase()] ?? method.toLowerCase()].join('.');
  return { action, target };
}

/** Shallow copy with secret-looking values replaced. Depth 1 — a trail, not a dump. */
export function redactBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      // One level is enough to say what changed without copying a payload into the trail.
      out[k] = Array.isArray(v) ? `[${v.length} item]` : '[object]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Records every state-changing request on the controllers it is attached to.
 *
 * CA-2-67: three groups of privileged writes left no trace at all — money settings, role
 * and RBAC-matrix changes, and admin-service's API keys, feature flags, webhooks and
 * security policy. admin-service had no audit client of any kind, although the
 * cross-service ingest path it needed had existed since H-29.
 *
 * Why an interceptor and not a call in each handler: the handlers are thin pass-throughs
 * and most of them do not even take `@CurrentUser()`, so hand-placing ~20 calls would mean
 * threading an actor through services that have no other use for one — and the next
 * controller somebody adds would silently not be covered. `scripts/check-audit-coverage.mjs`
 * fails the build when a mutating route in a covered service is neither intercepted nor
 * exempted with a written reason, so the coverage is the gate, not a habit.
 *
 * **Fail-open, like the rest of the trail.** An API key that was already rotated cannot be
 * un-rotated because the record of it did not save. A dropped entry is logged at `error`.
 *
 * Reads are ignored: GET traffic is the bulk of every console and a trail nobody can read
 * through is the same as no trail.
 */
@Injectable()
export class AuditMutationsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditMutationsInterceptor.name);

  constructor(@Optional() @Inject(AUDIT_MUTATION_SINK) private readonly sink?: AuditMutationSink) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = String(req?.method ?? 'GET').toUpperCase();
    if (!this.sink || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const url = String(req.originalUrl ?? req.url ?? '');
    const { action, target } = describeRoute(method, url);
    const actorId: string | null = req.user?.sub ?? null;
    const metadata = {
      ...(redactBody(req.body) ?? {}),
      ...(req.params && Object.keys(req.params).length ? { params: req.params } : {}),
    };

    const write = (success: boolean, extra?: Record<string, unknown>): void => {
      void this.sink!.record({
        action,
        actorId,
        target,
        success,
        metadata: { ...metadata, ...extra },
      }).catch((err) => {
        this.logger.error(`audit entry dropped for ${action}: ${(err as Error).message}`);
      });
    };

    return next.handle().pipe(
      tap({
        next: () => write(true),
        // A refused change is a decision too — a failed attempt to grant oneself a
        // capability is exactly what this trail exists to show.
        error: (err: unknown) => write(false, { error: (err as Error)?.message?.slice(0, 200) }),
      }),
    );
  }
}
