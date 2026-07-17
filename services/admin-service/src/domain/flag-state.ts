// Feature-flag lifecycle (Design 8b). Mirrors the Prisma FlagState enum but kept
// domain-local so application/domain code never imports the generated client.
//   ROLLOUT — gated ramp (see rolloutPct)
//   ACTIVE  — fully enabled
//   BETA    — opt-in / limited audience
//   OFF     — disabled
export enum FlagState {
  ROLLOUT = 'ROLLOUT',
  ACTIVE = 'ACTIVE',
  BETA = 'BETA',
  OFF = 'OFF',
}
