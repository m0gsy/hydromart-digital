import { IncidentCategory, IncidentSeverity } from '../../domain/incident';

export interface OpsIncidentAlert {
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
}

/** Pushes a HIGH incident to the shared ops notification feed. Fail-open: a
 *  delivered incident is already stored, so a failed alert only logs. */
export interface OpsNotifierPort {
  incidentReported(alert: OpsIncidentAlert): Promise<void>;
}
