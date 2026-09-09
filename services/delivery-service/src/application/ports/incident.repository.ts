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
  /**
   * CA-4-48: every incident a depot's couriers reported, newest first.
   *
   * `escalatesToOps` pushes HIGH severity to the ops feed and says LOW and MEDIUM are
   * "logged for later review" — but the only other reader was `listByDriver`, so the later
   * review could be done by exactly one person: the courier who wrote it. A breakdown, a
   * customer dispute, a damaged load — written down, and read by nobody who could act.
   *
   * `depotIds` undefined = network-wide, for a role that is not tied to one depot.
   */
  listForDepot(depotIds: readonly string[] | undefined, limit: number): Promise<IncidentRecord[]>;
}
