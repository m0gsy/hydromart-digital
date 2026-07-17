import { IncidentSeverity, IncidentStatus } from '../../domain/incident';

export interface IncidentUpdateRecord {
  id: string;
  incidentId: string;
  note: string;
  createdAt: Date;
}

export interface IncidentRecord {
  id: string;
  title: string;
  severity: IncidentSeverity;
  affectedService: string;
  status: IncidentStatus;
  startedAt: Date;
  resolvedAt: Date | null;
  note: string | null;
  updates: IncidentUpdateRecord[];
}

export interface CreateIncidentData {
  title: string;
  severity: IncidentSeverity;
  affectedService: string;
  note?: string | null;
}

/** A PATCH may append a timeline note and/or move the incident's status. */
export interface PatchIncidentData {
  note?: string;
  status?: IncidentStatus;
}

export interface ListIncidentsFilter {
  status?: IncidentStatus;
}

export interface IncidentRepository {
  /** Incidents (newest-first), optionally filtered, each with its timeline updates. */
  list(filter: ListIncidentsFilter): Promise<IncidentRecord[]>;
  create(data: CreateIncidentData): Promise<IncidentRecord>;
  /** Append an update and/or change status. Null when the id is unknown. */
  patch(id: string, data: PatchIncidentData): Promise<IncidentRecord | null>;
}
