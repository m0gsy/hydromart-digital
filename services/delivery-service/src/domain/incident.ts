// Field incident a courier reports from the road (design 4b): an accident, a
// breakdown, a threat, a damaged load. Stored here as the record of truth;
// HIGH-severity ones are pushed to the existing ops notification feed
// (crm COURIER_INCIDENT) so an operator sees them without a new ops screen.

export enum IncidentCategory {
  ACCIDENT = 'ACCIDENT',
  VEHICLE_BREAKDOWN = 'VEHICLE_BREAKDOWN',
  THEFT_OR_THREAT = 'THEFT_OR_THREAT',
  CUSTOMER_DISPUTE = 'CUSTOMER_DISPUTE',
  PRODUCT_DAMAGE = 'PRODUCT_DAMAGE',
  OTHER = 'OTHER',
}

export enum IncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/** Only HIGH incidents interrupt an operator (push to the ops feed); LOW/MEDIUM
 *  are logged for later review. Keeps the "what reaches ops" rule in one place. */
export function escalatesToOps(severity: IncidentSeverity): boolean {
  return severity === IncidentSeverity.HIGH;
}
