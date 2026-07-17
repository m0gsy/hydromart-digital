import { Inject, Injectable } from '@nestjs/common';

import {
  ApplicationAlreadyDecidedError,
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
import {
  CreateFranchiseApplicationData,
  FranchiseApplicationRecord,
  FranchiseApplicationRepository,
  ListApplicationsFilter,
} from '../ports/franchise-application.repository';
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
  constructor(
    @Inject(DEPOT_TOKENS.FranchiseApplicationRepository)
    private readonly applications: FranchiseApplicationRepository,
  ) {}

  create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord> {
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
    const checklist = patch.checklist
      ? mergeChecklist(app.checklist, patch.checklist)
      : undefined;
    return this.applications.update(id, { stage: patch.stage, checklist });
  }

  async approve(id: string): Promise<ApproveResult> {
    const app = await this.decide(id, FranchiseAppStage.APPROVED);
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

  reject(id: string): Promise<FranchiseApplicationRecord> {
    return this.decide(id, FranchiseAppStage.REJECTED);
  }

  private async decide(id: string, stage: FranchiseAppStage): Promise<FranchiseApplicationRecord> {
    const app = await this.require(id);
    if (isTerminalStage(app.stage)) throw new ApplicationAlreadyDecidedError();
    return this.applications.update(id, { stage });
  }

  private async require(id: string): Promise<FranchiseApplicationRecord> {
    const app = await this.applications.findById(id);
    if (!app) throw new FranchiseApplicationNotFoundError();
    return app;
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
