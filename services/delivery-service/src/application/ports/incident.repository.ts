import { IncidentCategory, IncidentSeverity } from '../../domain/incident';

export interface IncidentRecord {
  id: string;
  driverId: string;
  deliveryId: string | null;
  depotId: string | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  photoUrl: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
}

export interface CreateIncidentData {
  driverId: string;
  deliveryId: string | null;
  depotId: string | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  photoUrl: string | null;
  lat: number | null;
  lng: number | null;
}

export interface IncidentRepository {
  create(data: CreateIncidentData): Promise<IncidentRecord>;
  /** A courier's own reported incidents, newest first. */
  listByDriver(driverId: string, limit: number): Promise<IncidentRecord[]>;
}
