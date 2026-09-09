import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AuthenticatedUser, depotScopeIds } from '@hydromart/platform';

import { escalatesToOps, IncidentCategory, IncidentSeverity } from '../../domain/incident';
import { IncidentRecord, IncidentRepository } from '../ports/incident.repository';
import { OpsNotifierPort } from '../ports/ops-notifier.port';
import { StoragePort } from '../ports/storage.port';
import { DELIVERY_TOKENS } from '../tokens';
import { storageKeyFromUrl } from './delivery.service';

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
  /** Same window the PoD photo link uses: long enough to look at, short enough to expire. */
  private static readonly PHOTO_LINK_TTL_SECONDS = 15 * 60;
  /** CA-4-48: a review list, not an archive — the newest 100 for the depot. */
  private static readonly DEPOT_LIMIT = 100;
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(DELIVERY_TOKENS.OpsNotifier) private readonly ops: OpsNotifierPort,
    @Optional() @Inject(DELIVERY_TOKENS.Storage) private readonly storage?: StoragePort,
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
    this.logger.log(
      `Incident ${incident.id} (${incident.severity}/${incident.category}) reported by ${driverId}`,
    );

    if (escalatesToOps(incident.severity)) {
      await this.ops.incidentReported({
        category: incident.category,
        severity: incident.severity,
        description: incident.description,
        depotId: incident.depotId,
      });
    }
    return incident;
  }

  async listForDriver(driverId: string): Promise<IncidentRecord[]> {
    return this.incidents.listByDriver(driverId, IncidentService.HISTORY_LIMIT);
  }

  /**
   * CA-4-48: the depot's own review list.
   *
   * `escalatesToOps` interrupts an operator for HIGH only, and calls LOW and MEDIUM "logged
   * for later review". Nothing could review them: the only other read was the courier's own
   * history, so the person who wrote the report was the only person who could ever read it.
   * A breakdown, a customer dispute, a damaged load — recorded, and invisible to whoever had
   * to do something about it.
   */
  async listForDepot(user: AuthenticatedUser, depotId?: string): Promise<IncidentRecord[]> {
    const depotIds = depotScopeIds(user, depotId);
    return this.incidents.listForDepot(depotIds ?? undefined, IncidentService.DEPOT_LIMIT);
  }

  /**
   * CA-4-49, the half the first pass left behind — an incident photo.
   *
   * The bucket was made private and the PoD photo and signature moved to expiring signed
   * links. An incident's photo goes to the SAME bucket through the same upload endpoint,
   * and kept being handed out as the stored `${STORAGE_PUBLIC_BASE_URL}/<key>` string —
   * which since that change resolves to nothing at all. So the one picture of the accident,
   * the broken vehicle or the damaged load was a dead image on every screen that showed it,
   * and would have been an unauthenticated permanent link on any deployment whose bucket is
   * still public.
   *
   * Null when there is nothing to sign — no photo, a URL with no derivable key, or no
   * storage bound. The caller renders nothing rather than a broken frame.
   */
  async signedPhotoUrl(url: string | null): Promise<string | null> {
    if (!url || !this.storage) return null;
    const key = storageKeyFromUrl(url);
    if (!key) return null;
    return this.storage.signedUrl(key, IncidentService.PHOTO_LINK_TTL_SECONDS);
  }
}
