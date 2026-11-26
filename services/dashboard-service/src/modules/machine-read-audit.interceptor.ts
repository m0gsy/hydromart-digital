import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';

import { recordAuditEventOrThrow } from '@hydromart/platform';

import { DashboardConfigService } from '../config/dashboard-config.service';

const REFUSED = 'The audit trail is unavailable, so this read was not answered.';
/** What a read asks, as it is written to the trail: short plain values only. */
const ASKED = ['period', 'date', 'from', 'to', 'split'] as const;
/** A metric id such as P-01 or U-02; anything else is written as "invalid", never the caller's own string. */
const METRIC_ID = /^[A-Z]-?[0-9]{2}$/;

/**
 * AI-31: every read by a machine account (the AI web's own, no person behind it) is written to the
 * audit trail BEFORE it is answered, with the account id as the actor, and refused with 503 when the
 * row cannot be stored (fail closed, as the machine routes that write do). A person's token passes
 * through untouched. The row says what was asked (metric, period, split), never what was answered.
 */
@Injectable()
export class MachineReadAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MachineReadAuditInterceptor.name);

  constructor(private readonly config: DashboardConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (req?.user?.via !== 'machine') return next.handle();
    const query = (req.query ?? {}) as Record<string, unknown>;
    const asked: Record<string, string> = {};
    for (const key of ASKED) if (typeof query[key] === 'string') asked[key] = (query[key] as string).slice(0, 40);
    const metric = typeof query.metric === 'string' && METRIC_ID.test(query.metric) ? query.metric : 'invalid';
    asked.metric = metric;
    return from(
      recordAuditEventOrThrow(
        { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey },
        {
          action: 'dashboard.ai-read.money.requested',
          actorId: req.user.sub ?? null,
          target: asked.metric,
          success: true,
          metadata: { via: 'machine', ...asked },
        },
      ),
    ).pipe(
      catchError((err: unknown) => {
        this.logger.error(`audit entry failed, read refused: ${(err as Error).message}`);
        return throwError(() => new ServiceUnavailableException(REFUSED));
      }),
      switchMap(() => next.handle()),
    );
  }
}
