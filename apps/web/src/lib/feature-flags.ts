'use client';

import { api } from './api';
import { endpoints } from './endpoints';
import { useAsync } from './use-async';

/** The flags the platform enforces; admin-service's public route publishes only these. */
export type EnforcedFlag =
  | 'payments.cash_on_delivery'
  | 'subscriptions.galon'
  | 'recommendations.ai';

/**
 * Pure read of the public list. Fail-OPEN: a flag is off only when the server said so —
 * a missing key, a failed read, or no answer yet all mean "enabled", so head office's
 * console being unreachable never hides a feature from customers.
 */
export function flagEnabled(
  flags: { key: string; enabled: boolean }[] | null | undefined,
  key: EnforcedFlag,
): boolean {
  // Anything that is not the expected list (an error body, nothing) is "no opinion".
  if (!Array.isArray(flags)) return true;
  return flags.find((f) => f.key === key)?.enabled !== false;
}

export function useFeatureFlag(key: EnforcedFlag): boolean {
  // `async` so a synchronous throw while calling the client becomes a rejection the hook
  // already turns into "no answer" — a flag read must never take a screen down.
  const { data } = useAsync<{ key: string; enabled: boolean }[]>(async () =>
    api.getCached(endpoints.admin.publicFlags),
  );
  return flagEnabled(data, key);
}

/**
 * Flow 5d: flags that are a BRAKE. They read fail-CLOSED — on only when the server said so —
 * because a brake read the fail-open way above would be released exactly when head office's
 * console cannot be reached. A separate type, so one cannot be read through `flagEnabled`.
 */
export type BrakeFlag = 'attendance.courier_one_tap';

/** Pure read, fail-CLOSED: a missing key, a failed read and no answer yet are all "off". */
export function flagOn(
  flags: { key: string; enabled: boolean }[] | null | undefined,
  key: BrakeFlag,
): boolean {
  if (!Array.isArray(flags)) return false;
  return flags.find((f) => f.key === key)?.enabled === true;
}

/**
 * `null` until the answer is in, so a screen can wait for it instead of drawing one flow and
 * swapping. Read uncached: a brake pulled on the server should hold from the next screen
 * that asks, not after the shared minute-long cache of the public list runs out.
 */
export function useFlagOn(key: BrakeFlag): boolean | null {
  const { data, loading } = useAsync<{ key: string; enabled: boolean }[]>(async () =>
    api.get(endpoints.admin.publicFlags),
  );
  return loading ? null : flagOn(data, key);
}
