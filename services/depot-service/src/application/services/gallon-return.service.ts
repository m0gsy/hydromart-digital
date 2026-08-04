import { Inject, Injectable } from '@nestjs/common';

import { ApprovalType } from '../../domain/approval';
import { GallonCondition } from '../../domain/gallon-return';
import { DepotNotFoundError, GallonOverReturnError } from '../../domain/errors';
import { DepotConfigService } from '../../config/depot-config.service';
import { buildPage, Page } from '../pagination';
import { DepotRepository } from '../ports/depot.repository';
import { GallonIssueRepository } from '../ports/gallon-issue.repository';
import {
  GallonReturnRecord,
  GallonReturnRepository,
  GallonReturnSummary,
} from '../ports/gallon-return.repository';
import { DEPOT_TOKENS } from '../tokens';
import { ApprovalService } from './approval.service';

export interface RecordReturnInput {
  customerId?: string | null;
  quantity: number;
  condition?: GallonCondition;
  depositRefunded?: number;
  note?: string | null;
}

/** Courier handover return (design 2e): linked to an order, deposit derived from config. */
export interface CourierReturnInput {
  orderId: string;
  customerId?: string | null;
  quantity: number;
  condition?: GallonCondition;
  note?: string | null;
}

/**
 * Empty-gallon returns / deposit refunds (PRD Module 11 retur galon). A depot-scoped
 * append-only ledger of empties handed back and the deposit refunded. Standalone —
 * it does not yet increment the depot's GALON stock line.
 *
 * ponytail: pure ledger. Wiring GOOD returns into GALON inventory (an ADJUSTMENT
 * movement per return) is the follow-up when ops wants reconciled empty-gallon stock.
 */
@Injectable()
export class GallonReturnService {
  constructor(
    @Inject(DEPOT_TOKENS.GallonReturnRepository) private readonly returns: GallonReturnRepository,
    @Inject(DEPOT_TOKENS.GallonIssueRepository) private readonly issues: GallonIssueRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    private readonly config: DepotConfigService,
    private readonly approvals: ApprovalService,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  /**
   * Measure a return against what the depot still has outstanding.
   *
   * M15-11: handing back more empties than the depot issued is a DISCREPANCY, not an
   * impossibility — the gallons are physically on the counter (a customer bought
   * elsewhere, an issue went unrecorded, a depot transfer was missed). Rejecting the
   * return loses that fact entirely. So the excess is reported back to the caller,
   * which records the return and queues a GALLON_VARIANCE approval for a manager.
   *
   * Money is treated differently: an operator-entered refund above the deposit still
   * held is a typo, not a physical fact, and is still refused outright.
   *
   * ponytail: the balance is DEPOT-wide, not per-customer — it reuses the two
   * `summaryForDepot` rollups that already exist. Move to a per-customer balance (new
   * repo queries on both ledgers) when ops needs to block one customer over-returning
   * while the depot as a whole is still in credit.
   */
  private async measureAgainstOutstanding(
    depotId: string,
    quantity: number,
  ): Promise<{ excessGallons: number; depositLeft: number }> {
    const [issued, returned] = await Promise.all([
      this.issues.summaryForDepot(depotId),
      this.returns.summaryForDepot(depotId),
    ]);
    const gallonsLeft = issued.gallons - returned.gallons;
    return {
      excessGallons: Math.max(0, quantity - Math.max(0, gallonsLeft)),
      depositLeft: Math.max(0, issued.depositHeld - returned.depositRefunded),
    };
  }

  /**
   * Queue the discrepancy for a manager (M15-11). The rupiah at stake is the deposit
   * value of the unexplained empties, so the depot's existing auto-pass threshold
   * decides whether this needs a human at all.
   */
  private async queueVariance(
    depotId: string,
    excessGallons: number,
    returnId: string,
    actorId: string,
  ): Promise<void> {
    await this.approvals.create(
      {
        depotId,
        type: ApprovalType.GALLON_VARIANCE,
        title: `Retur galon melebihi saldo beredar (${excessGallons} galon)`,
        subjectRef: returnId,
        amountIdr: this.config.gallonDepositIdr(depotId) * excessGallons,
        payload: { excessGallons, returnId },
      },
      actorId,
    );
  }

  /**
   * M15-04: a DAMAGED empty is a deposit decision, not an automatic refund. It goes to
   * the queue under the DEPOSIT_REFUND type that already exists, carrying the value the
   * operator proposes and the reason they gave. Small amounts still auto-pass on the
   * depot's threshold, so this adds a paper trail without adding friction.
   */
  private async queueDamagedRefund(
    depotId: string,
    record: GallonReturnRecord,
    reason: string | null,
    actorId: string,
  ): Promise<void> {
    // What the operator proposes to refund; falls back to the deposit value at stake
    // when they proposed nothing, so the manager still sees the real exposure.
    const proposed =
      record.depositRefunded > 0
        ? record.depositRefunded
        : this.config.gallonDepositIdr(depotId) * record.quantity;
    await this.approvals.create(
      {
        depotId,
        type: ApprovalType.DEPOSIT_REFUND,
        title: `Retur galon rusak (${record.quantity} galon)`,
        subjectRef: record.id,
        amountIdr: proposed,
        payload: {
          returnId: record.id,
          quantity: record.quantity,
          depositRefunded: record.depositRefunded,
          reason,
        },
      },
      actorId,
    );
  }

  async record(
    depotId: string,
    input: RecordReturnInput,
    actorId: string,
  ): Promise<GallonReturnRecord> {
    await this.requireDepot(depotId);
    const depositRefunded = input.depositRefunded ?? 0;
    const { excessGallons, depositLeft } = await this.measureAgainstOutstanding(
      depotId,
      input.quantity,
    );
    if (depositRefunded > depositLeft) {
      throw new GallonOverReturnError('deposit', depositRefunded, depositLeft);
    }
    const condition = input.condition ?? GallonCondition.GOOD;
    const record = await this.returns.create({
      depotId,
      customerId: input.customerId ?? null,
      orderId: null,
      quantity: input.quantity,
      condition,
      depositRefunded,
      note: input.note ?? null,
      actorId,
    });
    if (excessGallons > 0) {
      await this.queueVariance(depotId, excessGallons, record.id, actorId);
    }
    if (condition === GallonCondition.DAMAGED) {
      await this.queueDamagedRefund(depotId, record, input.note ?? null, actorId);
    }
    return record;
  }

  /**
   * Courier records an empty-gallon return at delivery handover (design 2e). The refund is
   * derived server-side (GALLON_DEPOSIT_IDR × quantity) — the courier never supplies an
   * amount. DAMAGED empties still count for stock reconciliation but refund nothing.
   */
  async recordFromCourier(
    depotId: string,
    input: CourierReturnInput,
    courierId: string,
  ): Promise<GallonReturnRecord> {
    await this.requireDepot(depotId);
    const condition = input.condition ?? GallonCondition.GOOD;
    const { excessGallons, depositLeft } = await this.measureAgainstOutstanding(
      depotId,
      input.quantity,
    );
    // The courier never supplies an amount, so instead of refusing the handover when
    // the depot's held deposit is short, refund what is actually held. The gallons are
    // still recorded, and the shortfall surfaces as the variance approval below.
    const depositRefunded =
      condition === GallonCondition.GOOD
        ? Math.min(this.config.gallonDepositIdr(depotId) * input.quantity, depositLeft)
        : 0;
    const record = await this.returns.create({
      depotId,
      customerId: input.customerId ?? null,
      orderId: input.orderId,
      quantity: input.quantity,
      condition,
      depositRefunded,
      note: input.note ?? null,
      actorId: courierId,
    });
    if (excessGallons > 0) {
      await this.queueVariance(depotId, excessGallons, record.id, courierId);
    }
    if (condition === GallonCondition.DAMAGED) {
      await this.queueDamagedRefund(depotId, record, input.note ?? null, courierId);
    }
    return record;
  }

  async list(depotId: string, page: number, limit: number): Promise<Page<GallonReturnRecord>> {
    await this.requireDepot(depotId);
    const { items, total } = await this.returns.listForDepot(depotId, page, limit);
    return buildPage(items, total, page, limit);
  }

  async summary(depotId: string): Promise<GallonReturnSummary> {
    await this.requireDepot(depotId);
    return this.returns.summaryForDepot(depotId);
  }
}
