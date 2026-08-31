import * as Sentry from '@sentry/node';

import { alertServerError } from './error-alerter';

let guarded = false;

/**
 * Make a process that dies OUTSIDE a request say so before it goes.
 *
 * Everything this platform reports travels through `AllExceptionsFilter` — which only ever
 * sees a 5xx that Nest routed. Measured 2026-08-31: `grep -rn 'unhandledRejection|
 * uncaughtException'` across every service and package returned NOTHING in application code.
 * So the entire class of failure that happens away from an HTTP request was silent:
 *
 *   - `void bootstrap()` at the foot of all 18 `main.ts` — a boot that rejects (a bad
 *     DATABASE_URL, a migration lock, a port already bound) exits with a stack on stdout and
 *     nothing anywhere else;
 *   - the scheduler's sweeps, the outbox drain, every `setInterval` job;
 *   - a Postgres connection dropped between requests.
 *
 * A container that restart-loops on boot looks, from outside, exactly like one that is
 * starting slowly. That is the gap this closes.
 *
 * It does NOT change what happens next. Node crashes the process on both of these by
 * default, the restart policy brings it back, and swallowing either would leave a process
 * running in a state nobody can reason about. This only makes sure somebody is told first —
 * so the report is sent, flushed, and THEN the process dies exactly as it would have.
 */
export function guardProcess(serviceName: string): void {
  if (guarded) return;
  guarded = true;

  const report = (kind: string, error: unknown): void => {
    // Through the same door as a 5xx: Sentry when there is a DSN, the ops webhook either
    // way. A second reporting path would be a second thing to keep true.
    alertServerError({
      method: 'PROCESS',
      path: `${serviceName}#${kind}`,
      status: 0,
      exception: error,
    });
  };

  /*
   * `flush` before dying, or the report loses the race with the exit and the crash stays
   * invisible — which is the whole failure being fixed. Two seconds: long enough for one
   * HTTPS round trip, short enough that a crash-looping container still loops.
   */
  const dieAfterReporting = (code: number): void => {
    void Sentry.flush(2000)
      .catch(() => undefined)
      .then(() => process.exit(code));
  };

  process.on('uncaughtException', (error) => {
    // eslint-disable-next-line no-console
    console.error(`[${serviceName}] uncaughtException — this process is going down`, error);
    report('uncaughtException', error);
    dieAfterReporting(1);
  });

  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error(`[${serviceName}] unhandledRejection — this process is going down`, reason);
    report('unhandledRejection', reason);
    dieAfterReporting(1);
  });
}
