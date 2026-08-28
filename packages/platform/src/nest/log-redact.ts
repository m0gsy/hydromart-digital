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

/**
 * A phone number, written to a log without writing down the number.
 *
 * The rule is not new. `OtpService.maskPhone` in auth-service has masked numbers this way
 * for as long as OTP delivery has been logged — country code plus the last three digits,
 * short numbers left alone. What is new is that it lives somewhere the other services can
 * reach: it was a private static on a service class, so delivery-service and order-service
 * had no copy at all and logged the number whole.
 *
 * Why it is needed at all, and why pino's `redact` does not cover it: `LOG_REDACT_PATHS`
 * above walks the OBJECT paths of a log record, and a number interpolated into a message
 * string is just text by the time pino sees it. Three notification adapters interpolate one:
 *
 *   `${event} notification rejected (${response.status}) for ${phone}`
 *   `${event} notification skipped: "${phone}" is not a usable phone number`
 *
 * A phone number is personal data — `redactAlertText` already refuses to let one reach
 * Discord. Container logs are inside the trust boundary, but they are also outside the
 * retention engine that erases a customer's data on request, so a number written here
 * outlives the account it belongs to.
 *
 * `[phone]` wholesale is right for the alert path and wrong here: these lines exist to tell
 * one failed notification from another, and to show what was wrong with a number that would
 * not dial. Keeping the head and tail preserves both without keeping the subscriber.
 */
export function maskPhone(phone: string): string {
  // Below this there is no middle to hide, and starring the whole thing would throw away
  // the only diagnostic the line carries.
  if (phone.length <= 7) return phone;
  const head = phone.slice(0, 5);
  const tail = phone.slice(-3);
  return `${head}${'*'.repeat(phone.length - 8)}${tail}`;
}
