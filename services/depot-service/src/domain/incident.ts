// Depot operational incident vocabulary (design 6b operator "Insiden depot" + 13b
// manager view). Mirrors the Prisma enums; the domain never imports the generated client.

export enum IncidentType {
  COURIER_FALL = 'COURIER_FALL',
  VEHICLE_BREAKDOWN = 'VEHICLE_BREAKDOWN',
  CUSTOMER_CONFLICT = 'CUSTOMER_CONFLICT',
  POWER_OUTAGE = 'POWER_OUTAGE',
  GALLON_DAMAGE = 'GALLON_DAMAGE',
  OTHER = 'OTHER',
}

export enum IncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum IncidentStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
}

/** A depot-scoped operational incident (fall, breakdown, complaint, outage, damage). */
export interface Incident {
  id: string;
  depotId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  reportedBy: string;
  courierName: string | null;
  orderRef: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Still needs attention (OPEN or IN_PROGRESS) — drives the "N terbuka" header count. */
export function isOpen(incident: Pick<Incident, 'status'>): boolean {
  return incident.status !== IncidentStatus.RESOLVED;
}
