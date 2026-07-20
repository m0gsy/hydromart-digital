/**
 * Urgency of a depot broadcast — URGENT surfaces a banner in the courier inbox (design 8a).
 * SCHEDULED ("Terjadwal") is a distinct visual tier for planned, non-urgent notices.
 * ponytail: label-only tier — no deferred delivery / scheduler, no scheduledFor column.
 * The compose UI never asks for a send time; add scheduledFor + a cron only if the product
 * later needs actual deferred sending.
 */
export enum BroadcastLevel {
  INFO = 'INFO',
  URGENT = 'URGENT',
  SCHEDULED = 'SCHEDULED',
}
