/** The network-wide on-time threshold (admin-service /sla-policy, edited at /hq/sla-policy). */
export interface NetworkSlaPort {
  /** Minutes, or null when it cannot be read (no admin configured, or admin is down). */
  thresholdMinutes(): Promise<number | null>;
}
