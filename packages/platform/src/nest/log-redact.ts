import { INTERNAL_KEY_HEADER } from './internal-auth.guard';

/**
 * The pino `redact` list every service logs through.
 *
 * This is one constant rather than 18 copies for a reason. The array literal used to be
 * duplicated in every `app.module.ts`, and the duplication is what caused B-3: all 18
 * services redacted `authorization` and `cookie`, and none of them redacted
 * `x-internal-key` — the shared secret that the platform JWT guard accepts as a
 * `SUPER_ADMIN` principal on every route in every service. With `autoLogging: true`,
 * every service-to-service call wrote the master key into container logs in clear text.
 *
 * A redaction added here now reaches all of them. Adding one to a single service's module
 * does not — `log-redact.spec.ts` fails if any service grows its own local list again.
 *
 * The internal-key entry is built from INTERNAL_KEY_HEADER so renaming the header cannot
 * silently un-redact it, and uses bracket syntax because pino parses
 * `req.headers.x-internal-key` as an expression, not a path — it would match nothing and
 * look like it was working.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  `req.headers["${INTERNAL_KEY_HEADER}"]`,
];

/**
 * `LOG_REDACT_PATHS` plus service-specific paths. Use when a service handles secrets the
 * others do not (auth-service and its token bodies), so the shared list stays shared
 * instead of growing everyone else's entries.
 */
export function redactPaths(...extra: string[]): string[] {
  return [...LOG_REDACT_PATHS, ...extra];
}
