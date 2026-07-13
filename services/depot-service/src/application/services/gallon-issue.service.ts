import { Inject, Injectable } from '@nestjs/common';

import { DepotNotFoundError } from '../../domain/errors';
import { buildPage, Page } from '../pagination';
import { DepotRepository } from '../ports/depot.repository';
import {
  GallonIssueRecord,
  GallonIssueRepository,
  GallonIssueSummary,
} from '../ports/gallon-issue.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RecordIssueInput {
  customerId?: string | null;
  quantity: number;
  depositHeld?: number;
  note?: string | null;
}

/**
 * Empty-gallon issues / deposit held (PRD Module 11c) — the mirror image of retur
 * galon. A depot-scoped append-only ledger of empties handed OUT on deposit. The app
 * computes "galon di pelanggan / belum kembali / deposit tertahan" as issued − returned.
 *
 * ponytail: manual ledger. Auto-ingesting issues from an order-completed event
 * (order-service coupling) is a deliberate follow-up, not built here.
 */
@Injectable()
export class GallonIssueService {
  constructor(
    @Inject(DEPOT_TOKENS.GallonIssueRepository) private readonly issues: GallonIssueRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  async record(depotId: string, input: RecordIssueInput, actorId: string): Promise<GallonIssueRecord> {
    await this.requireDepot(depotId);
    return this.issues.create({
      depotId,
      customerId: input.customerId ?? null,
      quantity: input.quantity,
      depositHeld: input.depositHeld ?? 0,
      note: input.note ?? null,
      actorId,
    });
  }

  async list(depotId: string, page: number, limit: number): Promise<Page<GallonIssueRecord>> {
    await this.requireDepot(depotId);
    const { items, total } = await this.issues.listForDepot(depotId, page, limit);
    return buildPage(items, total, page, limit);
  }

  async summary(depotId: string): Promise<GallonIssueSummary> {
    await this.requireDepot(depotId);
    return this.issues.summaryForDepot(depotId);
  }
}
