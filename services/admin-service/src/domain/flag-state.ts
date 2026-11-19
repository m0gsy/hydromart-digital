// Feature-flag lifecycle (Design 8b). Mirrors the Prisma FlagState enum but kept
// domain-local so application/domain code never imports the generated client.
//   ROLLOUT — gated ramp (see rolloutPct)
//   ACTIVE  — fully enabled
//   BETA    — opt-in / limited audience
//   OFF     — disabled
/**
 * The flags some feature actually reads. Only these are published on the public read route:
 * an unreleased flag's name is not for the open internet, and a flag nothing enforces would
 * only imply a switch that moves nothing.
 */
export const ENFORCED_FLAG_KEYS = [
  'payments.cash_on_delivery',
  'subscriptions.galon',
  'recommendations.ai',
  // Flow 5d: read FAIL-CLOSED by the Ops app — the one-tap courier check-in runs only while
  // this says enabled. It is a brake; the three above are read fail-open.
  'attendance.courier_one_tap',
  // Flow 6a: read FAIL-CLOSED by crm — a leave request's push opens /hr/leave only while this
  // says enabled (the screen is pruned from the Ops APK up to v1.15.0).
  'notifications.leave_screen',
] as const;

/**
 * Enforced keys that are a BRAKE (read fail-closed). Published as enabled only while ACTIVE:
 * ROLLOUT and BETA have no audience to ramp in the app, and reading them as "on" would leave
 * the brake released under a state that looks partial — only the exact OFF would stop it.
 */
export const BRAKE_FLAG_KEYS: readonly string[] = [
  'attendance.courier_one_tap',
  'notifications.leave_screen',
];

export enum FlagState {
  ROLLOUT = 'ROLLOUT',
  ACTIVE = 'ACTIVE',
  BETA = 'BETA',
  OFF = 'OFF',
}
