import { Inject, Injectable, Logger } from '@nestjs/common';

import { escalatesToOps, IncidentCategory, IncidentSeverity } from '../../domain/incident';
import { IncidentRecord, IncidentRepository } from '../ports/incident.repository';
import { OpsNotifierPort } from '../ports/ops-notifier.port';
import { DELIVERY_TOKENS } from '../tokens';

export interface ReportIncidentData {
  deliveryId?: string;
  depotId?: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
}

@Injectable()
export class IncidentService {
  private static readonly HISTORY_LIMIT = 30;
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(DELIVERY_TOKENS.OpsNotifier) private readonly ops: OpsNotifierPort,
  ) {}

  /** Records the incident, then (HIGH only) alerts ops. The alert is fire-and-log:
   *  the incident is already stored, so a crm outage never fails the report. */
  async report(driverId: string, data: ReportIncidentData): Promise<IncidentRecord> {
    const incident = await this.incidents.create({
      driverId,
      deliveryId: data.deliveryId ?? null,
      depotId: data.depotId ?? null,
      category: data.category,
      severity: data.severity,
      description: data.description,
      photoUrl: data.photoUrl ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
    });
    this.logger.log(`Incident ${incident.id} (${incident.severity}/${incident.category}) reported by ${driverId}`);

    if (escalatesToOps(incident.severity)) {
      await this.ops.incidentReported({
        category: incident.category,
        severity: incident.severity,
        description: incident.description,
      });
    }
    return incident;
  }

  async listForDriver(driverId: string): Promise<IncidentRecord[]> {
    return this.incidents.listByDriver(driverId, IncidentService.HISTORY_LIMIT);
  }
}
