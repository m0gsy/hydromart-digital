import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { recordAuditEvent } from '@hydromart/platform';

import {
  ApplicationAlreadyDecidedError,
  DuplicateDepotCodeError,
  FranchiseApplicationNotFoundError,
} from '../../domain/errors';
import {
  Checklist,
  CHECKLIST_ITEMS,
  ChecklistItem,
  ChecklistItemStatus,
  FranchiseAppStage,
  isTerminalStage,
} from '../../domain/franchise-application';
import { buildPage, Page } from '../pagination';
import { DepotRepository } from '../ports/depot.repository';
import {
  CreateFranchiseApplicationData,
  FranchiseApplicationRecord,
  FranchiseApplicationRepository,
  ListApplicationsFilter,
} from '../ports/franchise-application.repository';
import { DepotConfigService } from '../../config/depot-config.service';
import { DEPOT_TOKENS } from '../tokens';

/** Onboard-form prefill returned on approval (WARALABA depot from the proposed fields). */
export interface ProposedDepot {
  code: string;
  name: string;
  ownershipType: 'WARALABA';
  city: string;
  province: string;
  lat: number;
  lng: number;
}

export interface ApproveResult {
  application: FranchiseApplicationRecord;
  proposedDepot: ProposedDepot;
}

/**
 * Franchise applications / approvals (design 5a/5b). HQ-only queue of prospective
 * franchise depots; oldest submitted surfaces first (highest SLA age). Approve marks
 * the application APPROVED and hands back the proposed-depot payload the web uses to
 * prefill the depot onboard form — provisioning the actual depot stays a separate,
 * explicit step (no side-effect depot creation here).
 */
@Injectable()
export class FranchiseApplicationService {
  private readonly logger = new Logger(FranchiseApplicationService.name);

  constructor(
    @Inject(DEPOT_TOKENS.FranchiseApplicationRepository)
    private readonly applications: FranchiseApplicationRepository,
    @Inject(DEPOT_TOKENS.DepotRepository)
    private readonly depots: DepotRepository,
    @Optional() private readonly config?: DepotConfigService,
  ) {}

  /**
   * A code already worn by a live depot is rejected at submit, not at approval: approve()
   * hands its proposed code straight to the depot onboard form, which would then fail
   * DuplicateDepotCodeError after a human had already reviewed the whole application.
   * Two PENDING applications may still propose the same code — nothing is provisioned yet,
   * and HQ deciding between two candidates for one area is the queue doing its job.
   */
  async create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord> {
    if (await this.depots.findByCode(data.proposedCode)) {
      throw new DuplicateDepotCodeError();
    }
    return this.applications.create(data);
  }

  async list(filter: ListApplicationsFilter): Promise<Page<FranchiseApplicationRecord>> {
    const { items, total } = await this.applications.list(filter);
    return buildPage(items, total, filter.page, filter.limit);
  }

  async get(id: string): Promise<FranchiseApplicationRecord> {
    return this.require(id);
  }

  async patch(
    id: string,
    patch: { stage?: FranchiseAppStage; checklist?: Partial<Checklist> },
  ): Promise<FranchiseApplicationRecord> {
    const app = await this.require(id);
    // A decided application is frozen; use approve/reject for the decision itself.
    if (isTerminalStage(app.stage)) throw new ApplicationAlreadyDecidedError();
    // Merge only known items/statuses over the stored checklist (partial PATCH).
    const checklist = patch.checklist ? mergeChecklist(app.checklist, patch.checklist) : undefined;
    return this.applications.update(id, { stage: patch.stage, checklist });
  }

  async approve(id: string, actorId?: string, reason?: string): Promise<ApproveResult> {
    const app = await this.decide(id, FranchiseAppStage.APPROVED, reason);
    await this.audit('depot.franchise_application.approved', app, actorId, true, reason);
    return {
      application: app,
      proposedDepot: {
        code: app.proposedCode,
        name: app.proposedName,
        ownershipType: 'WARALABA',
        city: app.city,
        province: app.province,
        lat: app.lat,
        lng: app.lng,
      },
    };
  }

  async reject(
    id: string,
    actorId?: string,
    reason?: string,
  ): Promise<FranchiseApplicationRecord> {
    const app = await this.decide(id, FranchiseAppStage.REJECTED, reason);
    await this.audit('depot.franchise_application.rejected', app, actorId, false, reason);
    return app;
  }

  /** The decision and its reason go to the shared trail. Fail-open: it is already made. */
  private async audit(
    action: string,
    app: FranchiseApplicationRecord,
    actorId: string | undefined,
    success: boolean,
    reason?: string,
  ): Promise<void> {
    if (!this.config) return;
    await recordAuditEvent(
      {
        authServiceUrl: this.config.authServiceUrl,
        internalServiceKey: this.config.internalServiceKey,
      },
      {
        action,
        actorId: actorId || null,
        target: `${app.proposedName} · ${app.proposedCode}`,
        success,
        metadata: {
          applicationId: app.id,
          ...(reason?.trim() ? { reason: reason.trim().slice(0, 300) } : {}),
        },
      },
      this.logger,
    );
  }

  private async decide(
    id: string,
    stage: FranchiseAppStage,
    reason?: string,
  ): Promise<FranchiseApplicationRecord> {
    const app = await this.require(id);
    if (isTerminalStage(app.stage)) throw new ApplicationAlreadyDecidedError();
    // Stored on the row so the queue and the detail page can show WHY; the audit trail
    // keeps the same text beside the actor.
    return this.applications.update(id, {
      stage,
      decisionReason: reason?.trim().slice(0, 300) || null,
    });
  }

  private async require(id: string): Promise<FranchiseApplicationRecord> {
    const app = await this.applications.findById(id);
    if (!app) throw new FranchiseApplicationNotFoundError();
    return app;
  }

  /**
   * CA-3-53 — retention sweep, driven by admin-service's purge engine.
   *
   * The cutoff is passed in rather than computed here: the retention policy table is the
   * one place that decides how long anything is kept, exactly as the proof-of-delivery
   * sweep works. This service owns the rows, never the rule.
   */
  async purgeRejectedOlderThan(cutoff: Date): Promise<{ deleted: number }> {
    const deleted = await this.applications.purgeRejectedBefore(cutoff);
    if (deleted > 0) {
      this.logger.log(
        `Purged ${deleted} rejected franchise application(s) decided before ${cutoff.toISOString()}`,
      );
    }
    return { deleted };
  }
}

const STATUSES = new Set<string>(Object.values(ChecklistItemStatus));

/** Overlay only recognized items with valid statuses; ignore anything else. */
function mergeChecklist(current: Checklist, patch: Partial<Checklist>): Checklist {
  const next: Checklist = { ...current };
  for (const item of CHECKLIST_ITEMS) {
    const value = patch[item as ChecklistItem];
    if (value !== undefined && STATUSES.has(value)) next[item] = value;
  }
  return next;
}
