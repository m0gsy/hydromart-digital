import { IncidentCategory, IncidentSeverity } from '../../domain/incident';

export interface OpsIncidentAlert {
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  /**
   * F8. The depot the incident happened at, so crm can push it to that depot's staff.
   * Without it the alert reached the ops feed and no device at all — it had no channel
   * that could wake anybody, which for a HIGH-severity field incident is the whole point.
   * Null when the courier reported one with no depot on it; the feed row is unaffected.
   */
  depotId: string | null;
}

/** Pushes a HIGH incident to the shared ops notification feed. Fail-open: a
 *  delivered incident is already stored, so a failed alert only logs. */
export interface OpsNotifierPort {
  incidentReported(alert: OpsIncidentAlert): Promise<void>;
}
