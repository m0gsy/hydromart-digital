/**
 * HD-6 #19: the one SLA colour band every screen shares. These are the admin /hq/sla-policy
 * defaults (healthy from 95%, critical below 85%); a screen that colours an SLA percentage
 * imports them instead of carrying its own cut-off (it used to be 88, 90 and 96).
 * // ponytail: constants, not the saved policy; read healthyBandPct/criticalBandPct from
 * // /hq/sla-policy here if the owner wants the bands editable per network.
 */
export const SLA_HEALTHY_PCT = 95;
export const SLA_CRITICAL_PCT = 85;

/** `pct` is 0-100. Anything under the critical band needs attention. */
export const isSlaCritical = (pct: number): boolean => pct < SLA_CRITICAL_PCT;
