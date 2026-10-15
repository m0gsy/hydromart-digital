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
] as const;

export enum FlagState {
  ROLLOUT = 'ROLLOUT',
  ACTIVE = 'ACTIVE',
  BETA = 'BETA',
  OFF = 'OFF',
}
