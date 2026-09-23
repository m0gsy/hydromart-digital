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
    const submitted = this.sanitize(request.body);

    return next.handle().pipe(
      tap((body) => {
        void this.audit.record({
          actorId: user?.sub ?? null,
          action: request.method,
          entity,
          entityId: entityId ?? this.bodyId(body),
          // `after` = the fields the caller submitted (sanitized). A true prior-state `before`
          // is captured explicitly where it matters (e.g. AttendanceAdjustment before/after).
          before: null,
          after: submitted,
          ip: ipAddress,
        });
      }),
    );
  }

  /**
   * Drop heavy/sensitive keys (face frames, vectors, secrets), redact personal data, and cap
   * the payload size.
   *
   * HR-2: this row said WHAT changed by storing the submitted value, so one POST of an
   * employee form put the NIK, the home address, the birth date, the bank account and the
   * salary into a table nothing ever deleted — and the departed-staff scrub rewrote the
   * employee row while leaving every audit copy of it intact. An audit trail needs to name
   * the field that moved and who moved it; it does not need the number itself. The key stays
   * so the trail still reads "salary was changed", the value becomes `[redacted]`.
   */
  private sanitize(body: unknown): Record<string, unknown> | null {
    if (!body || typeof body !== 'object') return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (DROP.has(k)) {
        out[k] = '[omitted]';
        continue;
      }
      if (isPersonal(k)) {
        out[k] = v === null || v === undefined ? v : '[redacted]';
        continue;
      }
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      out[k] = s != null && s.length > 500 ? `${s.slice(0, 500)}…` : v;
    }
    return Object.keys(out).length ? out : null;
  }

  /** `/api/v1/employees/<uuid>/face/enroll` -> entity "employees", entityId the uuid (if any). */
  private parseRoute(path: string): { entity: string; entityId: string | null } {
    const segments = path
      .replace(/^\/api(\/v\d+)?\//, '')
      .split('/')
      .filter(Boolean);
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

/** Bodies too heavy or too secret to keep at all — the key is kept, the value never was. */
const DROP = new Set(['image', 'images', 'vector', 'password', 'secret', 'photoUrl', 'sourcePhotoUrl']);

/**
 * HR-2 — personal data whose VALUE has no place in an audit row: identity documents, contact
 * details, home address, next-of-kin, bank destination and pay. Matched case-insensitively on
 * the field name so `bankAccount`, `emergencyPhone` and `monthlyRate` are caught without
 * listing every spelling, and so a new field named like one of these is redacted the day it
 * is added rather than the day somebody notices.
 */
const PERSONAL = [
  'nik',
  'ktp',
  'npwp',
  'bpjs',
  'phone',
  'email',
  'address',
  'birthdate',
  'dob',
  'bank',
  'account',
  'salary',
  'rate',
  'wage',
  'fullname',
  'name',
  'emergency',
];

export function isPersonal(key: string): boolean {
  const k = key.toLowerCase();
  // `name` alone would redact `departmentName` and `shiftName` too — which is harmless, they
  // are not evidence of anything — but `bankName` is the one that matters.
  return PERSONAL.some((p) => k.includes(p));
}
