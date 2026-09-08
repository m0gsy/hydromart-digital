import { Inject, Injectable, Logger } from '@nestjs/common';

import { ApprovalType } from '../../domain/approval';
import { InventoryItemType } from '../../domain/inventory';
import { DepotConfigService } from '../../config/depot-config.service';
import { DepotNotFoundError } from '../../domain/errors';
import { ApprovalService } from './approval.service';
import { InventoryService } from './inventory.service';
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
    // CA-2-57: the ledger below now moves the physical GALON line too. No DI cycle —
    // InventoryService injects ApprovalService, not the other way and not this service.
    private readonly inventory: InventoryService,
    private readonly approvals: ApprovalService,
  ) {}

  private readonly logger = new Logger(GallonIssueService.name);

  /**
   * CA-2-57: an issue is empties LEAVING the depot, so the physical line goes down.
   *
   * Two things can go wrong and neither may be silent. If the depot has no GALON line the
   * ledger row still stands and there is nothing to move — logged, because a depot handing
   * out gallons with no gallon line is a setup fault somebody has to fix. If the line cannot
   * cover the issue, the gallons still left the building: the movement is clamped to what
   * the count had and the remainder goes to a manager as a GALLON_VARIANCE, the same
   * treatment an over-return already gets.
   */
  private async moveStockOut(
    depotId: string,
    record: GallonIssueRecord,
    actorId: string,
    orderId?: string,
  ): Promise<void> {
    const moved = await this.inventory.moveRawLine(
      depotId,
      InventoryItemType.GALON,
      -record.quantity,
      actorId,
      `Galon keluar (deposit) ${record.id}`,
      orderId,
    );
    if (!moved) {
      this.logger.warn(
        `depot ${depotId} has no GALON inventory line; issue ${record.id} booked in the ledger only`,
      );
      return;
    }
    if (moved.shortfall > 0) {
      await this.approvals.create(
        {
          depotId,
          type: ApprovalType.GALLON_VARIANCE,
          title: `Stok galon fisik tidak menutupi galon keluar (${moved.shortfall} galon)`,
          subjectRef: record.id,
          amountIdr: this.config.gallonDepositIdr(depotId) * moved.shortfall,
          payload: { shortfallGallons: moved.shortfall, issueId: record.id },
        },
        actorId,
      );
    }
  }

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
    const record = await this.issues.create({
      depotId,
      customerId: input.customerId ?? null,
      quantity: input.quantity,
      depositHeld: input.depositHeld ?? 0,
      note: input.note ?? null,
      actorId,
    });
    await this.moveStockOut(depotId, record, actorId);
    return record;
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
    const record = await this.issues.createFromOrder({
      depotId,
      orderId: input.orderId,
      customerId: input.customerId ?? null,
      quantity: input.quantity,
      depositHeld: this.config.gallonDepositIdr(depotId) * input.quantity,
      note: null,
      actorId,
    });
    // The order id rides along: this fan-out is at-least-once, and without it a retried
    // completion would deduct the same empties twice.
    await this.moveStockOut(depotId, record, actorId, input.orderId);
    return record;
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
