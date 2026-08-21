import { Inject, Injectable } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
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
 * I1: what fulfilment reports when a delivery hands empties out. Deliberately carries NO
 * money — the deposit is derived here from the depot's own rate, the same way
 * `recordFromCourier` derives the refund. A caller that could name the amount could book a
 * deposit the depot never charged, and the ledger is what every later refund is measured
 * against.
 */
export interface RecordIssueFromOrderInput {
  orderId: string;
  customerId?: string | null;
  quantity: number;
}

/**
 * Empty-gallon issues / deposit held (PRD Module 11c) — the mirror image of retur
 * galon. A depot-scoped append-only ledger of empties handed OUT on deposit. The app
 * computes "galon di pelanggan / belum kembali / deposit tertahan" as issued − returned.
 *
 * I1: fulfilment writes it now, through `recordFromOrder`. It used to be written by nobody
 * but the manual returns screen, which is why `depositHeld` was 0 for every depot in
 * production — and why every courier return refunded min(rate × qty, 0) = Rp0 and queued a
 * GALLON_VARIANCE approval, measuring itself against an empty book.
 *
 * The symmetry is the point, and it is the model the return side already assumes: every
 * gallon that leaves on deposit is booked here, every gallon handed back refunds it. A
 * refill exchange therefore nets to zero (issue +1, return −1) without needing a concept
 * of "exchange" the catalogue does not have.
 */
@Injectable()
export class GallonIssueService {
  constructor(
    @Inject(DEPOT_TOKENS.GallonIssueRepository) private readonly issues: GallonIssueRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  async record(
    depotId: string,
    input: RecordIssueInput,
    actorId: string,
  ): Promise<GallonIssueRecord> {
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

  /**
   * I1: book the empties a completed delivery carried out, from fulfilment rather than
   * from a person. Idempotent on the order id — the completion fan-out is at-least-once.
   *
   * The deposit is derived from the depot's rate here, never supplied by the caller.
   */
  async recordFromOrder(
    depotId: string,
    input: RecordIssueFromOrderInput,
    actorId: string,
  ): Promise<GallonIssueRecord> {
    await this.requireDepot(depotId);
    return this.issues.createFromOrder({
      depotId,
      orderId: input.orderId,
      customerId: input.customerId ?? null,
      quantity: input.quantity,
      depositHeld: this.config.gallonDepositIdr(depotId) * input.quantity,
      note: null,
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
