import { Inject, Injectable } from '@nestjs/common';

import { Incident, IncidentSeverity, IncidentStatus, IncidentType } from '../../domain/incident';
import { DepotNotFoundError, IncidentNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { IncidentRepository } from '../ports/incident.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RecordIncidentInput {
  depotId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description?: string | null;
  courierName?: string | null;
  orderRef?: string | null;
}

export interface ListIncidentFilters {
  status?: IncidentStatus;
}

/**
 * Depot operational incidents (design 6b operator "Insiden depot" + 13b manager).
 * A depot-scoped log of field/ops events (courier fall, breakdown, complaint, outage,
 * gallon damage) with an OPEN → IN_PROGRESS → RESOLVED lifecycle.
 */
@Injectable()
export class IncidentService {
  constructor(
    @Inject(DEPOT_TOKENS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<Incident> {
    const found = await this.incidents.findById(id);
    if (!found) throw new IncidentNotFoundError();
    return found;
  }

  async record(input: RecordIncidentInput, reportedBy: string): Promise<Incident> {
    await this.requireDepot(input.depotId);
    return this.incidents.create({
      depotId: input.depotId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      description: input.description ?? null,
      reportedBy,
      courierName: input.courierName ?? null,
      orderRef: input.orderRef ?? null,
    });
  }

  async list(depotId: string, filters: ListIncidentFilters = {}): Promise<Incident[]> {
    await this.requireDepot(depotId);
    return this.incidents.listForDepot(depotId, filters.status);
  }

  get(id: string): Promise<Incident> {
    return this.require(id);
  }

  /** Mark an incident RESOLVED with a note + the resolver's account id. */
  async resolve(id: string, note: string, resolvedBy: string): Promise<Incident> {
    await this.require(id);
    return this.incidents.update(id, {
      status: IncidentStatus.RESOLVED,
      resolutionNote: note,
      resolvedBy,
      resolvedAt: new Date(),
    });
  }

  /** Transition status without resolving (e.g. OPEN → IN_PROGRESS). */
  async updateStatus(id: string, status: IncidentStatus): Promise<Incident> {
    await this.require(id);
    // Clearing back from RESOLVED drops the resolution fields to keep the row honest.
    const patch =
      status === IncidentStatus.RESOLVED
        ? { status, resolvedAt: new Date() }
        : { status, resolutionNote: null, resolvedBy: null, resolvedAt: null };
    return this.incidents.update(id, patch);
  }
}
