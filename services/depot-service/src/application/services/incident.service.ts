import { Inject, Injectable } from '@nestjs/common';

import { Incident, IncidentSeverity, IncidentStatus, IncidentType } from '../../domain/incident';
import { HqComplaintPort } from '../ports/hq-complaint.port';
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
  /** CA-2-58: the complainant's number, when the operator took one. */
  customerPhone?: string | null;
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
    @Inject(DEPOT_TOKENS.HqComplaint) private readonly hq: HqComplaintPort,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<Incident> {
    const found = await this.incidents.findById(id);
    if (!found) throw new IncidentNotFoundError();
    return found;
  }

  /**
   * CA-2-58 — a customer complaint recorded here also reaches head office.
   *
   * It used to reach nobody. Head office keeps its own complaint queue; this inbox keeps
   * `CUSTOMER_CONFLICT` rows; nothing linked them, so a complaint taken at the counter was
   * invisible upstairs and the customer's follow-up depended on whoever was standing there.
   *
   * Only a COMPLAINT is mirrored, and only when the operator took a number: a ticket head
   * office cannot call back on is a row, not a complaint. Everything else — a courier's
   * fall, a broken motorbike — is depot operations and belongs here alone.
   *
   * The mirror runs AFTER the incident is saved and cannot undo it. Head office being
   * unreachable must not throw away the depot's own record; what it does instead is leave
   * `hqTicketRef` null, which the screen shows as "not forwarded" rather than pretending.
   */
  async record(input: RecordIncidentInput, reportedBy: string): Promise<Incident> {
    await this.requireDepot(input.depotId);
    const phone = input.customerPhone?.trim() || null;
    const incident = await this.incidents.create({
      depotId: input.depotId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      description: input.description ?? null,
      reportedBy,
      courierName: input.courierName ?? null,
      orderRef: input.orderRef ?? null,
      customerPhone: phone,
    });
    if (input.type !== IncidentType.CUSTOMER_CONFLICT || !phone) return incident;

    const ticketId = await this.hq.open({
      depotId: incident.depotId,
      // The number IS the reference. The incident form asks the operator for one field,
      // not two, and a phone number names the complainant unambiguously — where a typed
      // name at a counter very often does not.
      customerRef: phone,
      customerPhone: phone,
      subject: incident.title,
      body: incident.description ?? incident.title,
      orderRef: incident.orderRef,
    });
    if (!ticketId) return incident;
    return this.incidents.update(incident.id, { hqTicketRef: ticketId });
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
