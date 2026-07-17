import { Incident, IncidentSeverity, IncidentStatus, IncidentType } from '../../domain/incident';

export interface CreateIncidentData {
  depotId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string | null;
  reportedBy: string;
  courierName: string | null;
  orderRef: string | null;
}

/** Partial patch: status transition and/or resolution fields. */
export interface UpdateIncidentData {
  status?: IncidentStatus;
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
}

export interface IncidentRepository {
  create(data: CreateIncidentData): Promise<Incident>;
  /** A depot's incidents, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: IncidentStatus): Promise<Incident[]>;
  findById(id: string): Promise<Incident | null>;
  update(id: string, data: UpdateIncidentData): Promise<Incident>;
}
