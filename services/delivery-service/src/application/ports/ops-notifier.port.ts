import { IncidentCategory, IncidentSeverity } from '../../domain/incident';

export interface OpsIncidentAlert {
  /** Flow 6a: crm opens this incident on the depot's incident screen when the push is tapped. */
  incidentId: string;
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
  /**
   * J8. Fail-open like the incident alert, but it reports WHETHER it got through:
   * the sweep only marks a delivery alerted once it did, so an unreachable crm means
   * the next tick tries the same delivery again instead of losing the breach quietly.
   */
  slaBreached(alert: OpsSlaBreachAlert): Promise<boolean>;
  /**
   * Flow 6b: a courier handed in a shift's cash; crm wakes the accounts that may verify it
   * (`courierSettle`). Fail-open like the incident alert: the settlement is already stored.
   */
  settlementSubmitted(alert: OpsSettlementAlert): Promise<void>;
}

export interface OpsSettlementAlert {
  settlementId: string;
  depotId: string | null;
  depositedAmount: number;
  /** Deposited minus expected: negative is a shortfall. */
  variance: number;
}

/**
 * J8. One in-flight delivery that has now been on the road longer than its depot's SLA.
 * `minutes` is how long, `thresholdMinutes` the window it blew — both carried so the
 * message can say by how much rather than only that it happened.
 */
export interface OpsSlaBreachAlert {
  /** Flow 6a: the tap opens this order in the depot queue. */
  orderId: string;
  orderNumber: string;
  minutes: number;
  thresholdMinutes: number;
  depotId: string | null;
}
