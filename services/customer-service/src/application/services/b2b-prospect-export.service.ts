import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, depotScopeIds, recordAuditEventOrThrow } from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';
import { B2bCategory, B2bProspectStatus, ProspectRecord } from '../../domain/b2b-prospect';
import { reachOf } from '../../domain/prospect-reach';
import { RegionLookup } from '../../infrastructure/geo/region-lookup';
import { B2bProspectRepository } from '../ports/b2b-prospect.repository';
import { CUSTOMER_TOKENS } from '../tokens';

/** One call never returns more than this many rows; `truncated` says so. */
export const EXPORT_MAX = 5000;
/** The visits sheet is capped too (5000 prospects x a few visits each). */
export const EXPORT_VISITS_MAX = 20000;

/** A visit of an exported prospect: `rowIndex` points into `rows`; no pin, no note, no prospect id. */
export interface ExportVisitRow {
  rowIndex: number;
  visitorId: string;
  visitedAt: string;
  outcome: string;
  distanceM: number;
}

export interface ExportFilters {
  depotId?: string;
  status?: B2bProspectStatus;
  category?: B2bCategory;
  kecamatanCode?: string;
  assigned?: string;
}

export interface ExportRow {
  id: string;
  name: string;
  category: B2bCategory;
  phone: string | null;
  contactName: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  kecamatanCode: string | null;
  kecamatan: string | null;
  kelurahanCode: string | null;
  kelurahan: string | null;
  status: B2bProspectStatus;
  ownerDepotId: string | null;
  assignedToId: string | null;
  source: string;
  licence: string | null;
  sourceId: string | null;
  sourceDate: string | null;
}

/** A cell a spreadsheet would run as a formula. */
const FORMULA = /^[=+\-@\t\r]/;
/** Prefixing an apostrophe makes Excel and Sheets read the cell as text. */
const neutralise = (v: string | null): string | null => (v !== null && FORMULA.test(v) ? "'" + v : v);

/**
 * Export of prospects as rows (the web builds the sheet). Fail-closed: the audit entry is written
 * BEFORE any row leaves, and if it cannot be written (auth-service down or unconfigured) nothing
 * is returned and the caller gets a 503. The entry carries ids, counts and filter codes only.
 */
@Injectable()
export class B2bProspectExportService {
  private readonly logger = new Logger(B2bProspectExportService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.B2bProspectRepository) private readonly repo: B2bProspectRepository,
    private readonly config: CustomerConfigService,
    @Optional() private readonly regions?: RegionLookup,
  ) {}

  async export(
    user: AuthenticatedUser,
    q: ExportFilters,
  ): Promise<{ rows: ExportRow[]; truncated: boolean; rowCount: number; visits: ExportVisitRow[] }> {
    // Validates a named depot against the caller's own and defaults an unnamed one to theirs: a Kepala is
    // locked to their depot, a network role may name any (or none = all, including the map).
    const depotIds = depotScopeIds(user, q.depotId);
    // A role that may export but not manage only ever sees what is assigned to it.
    const mine = reachOf(user, depotIds).assignedOnly || q.assigned === 'me';
    const found = await this.repo.exportRows({
      depotIds,
      status: q.status,
      category: q.category,
      kecamatanCode: q.kecamatanCode,
      assignedToId: mine ? user.sub : q.assigned && q.assigned !== 'none' ? q.assigned : undefined,
      unassigned: !mine && q.assigned === 'none',
      take: EXPORT_MAX + 1,
    });
    const truncated = found.length > EXPORT_MAX;
    const rows = found.slice(0, EXPORT_MAX).map((r) => this.toRow(r));

    const indexOf = new Map(rows.map((r, i) => [r.id, i]));
    const visits = (await this.repo.exportVisits([...indexOf.keys()], EXPORT_VISITS_MAX)).map((v) => ({
      rowIndex: indexOf.get(v.prospectId) as number,
      visitorId: v.visitorId,
      visitedAt: v.visitedAt.toISOString(),
      outcome: v.outcome,
      distanceM: v.distanceM,
    }));

    const sources: Record<string, number> = {};
    for (const r of rows) sources[r.source] = (sources[r.source] ?? 0) + 1;
    try {
      await recordAuditEventOrThrow(
        { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey },
        {
          action: 'b2b.prospect.export',
          actorId: user.sub,
          target: `b2b-prospects:${depotIds ? depotIds.join(',') : 'network'}`,
          metadata: {
            rowCount: rows.length,
            visitCount: visits.length,
            truncated,
            sources,
            status: q.status ?? null,
            category: q.category ?? null,
            kecamatanCode: q.kecamatanCode ?? null,
            assigned: q.assigned === 'me' || q.assigned === 'none' ? q.assigned : q.assigned ? 'staff' : null,
          },
        },
      );
    } catch (error) {
      this.logger.error(`B2B prospect export refused: the audit entry was not recorded (${(error as Error).name})`);
      throw new ServiceUnavailableException('Ekspor dibatalkan: catatan audit gagal');
    }
    return { rows, truncated, rowCount: rows.length, visits };
  }

  private toRow(r: ProspectRecord): ExportRow {
    const name = (code: string | null) => (code ? (this.regions?.nameOf(code) ?? null) : null);
    return {
      id: r.id,
      name: neutralise(r.name) as string,
      category: r.category,
      phone: r.phoneE164, // a number starts with "+": the one text column left alone on purpose
      contactName: neutralise(r.contactName),
      address: neutralise(r.address),
      latitude: r.latitude,
      longitude: r.longitude,
      kecamatanCode: r.kecamatanCode,
      kecamatan: neutralise(name(r.kecamatanCode)),
      kelurahanCode: r.kelurahanCode,
      kelurahan: neutralise(name(r.kelurahanCode)),
      status: r.status,
      ownerDepotId: r.ownerDepotId,
      assignedToId: r.assignedToId,
      source: r.source,
      licence: neutralise(r.licence),
      sourceId: neutralise(r.sourceId),
      sourceDate: r.sourceDate ? r.sourceDate.toISOString() : null,
    };
  }
}
