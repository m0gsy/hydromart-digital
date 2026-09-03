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
   * I2: measured PER CUSTOMER when the return names one, not depot-wide.
   *
   * Depot-wide was the leak. One customer's refund came out of the depot's pooled balance,
   * so a person who had never left a gallon or a rupiah here could be paid out of somebody
   * else's deposit — and the depot's own total still looked healthy, so nothing complained.
   * The per-customer rows this reads are the same ones the customer directory already
   * shows; only the cap was measured against the wrong set.
   *
   * A return with NO customer keeps the depot-wide measure. That is not a leftover: an
   * anonymous counter return has no person to hold a balance against, and refusing it
   * outright would lose a gallon that is physically on the counter. The depot total is the
   * only bound that exists for it.
   */
  private async measureAgainstOutstanding(
    depotId: string,
    quantity: number,
    customerId: string | null,
  ): Promise<{ excessGallons: number; depositLeft: number }> {
    // Both branches answer in the same shape, so the arithmetic below is written once.
    const [issued, returned] = customerId
      ? await Promise.all([
          this.issues.summaryForCustomerAtDepot(depotId, customerId),
          this.returns.summaryForCustomerAtDepot(depotId, customerId),
        ])
      : await Promise.all([
          this.issues
            .summaryForDepot(depotId)
            .then((r) => ({ gallons: r.gallons, amountIdr: r.depositHeld })),
          this.returns
            .summaryForDepot(depotId)
            .then((r) => ({ gallons: r.gallons, amountIdr: r.depositRefunded })),
        ]);
    const gallonsLeft = issued.gallons - returned.gallons;
    return {
      excessGallons: Math.max(0, quantity - Math.max(0, gallonsLeft)),
      depositLeft: Math.max(0, issued.amountIdr - returned.amountIdr),
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

  /**
   * CA-4-47: an unidentified return, queued so the deposit is somebody's decision.
   *
   * The empties are real and are recorded; the deposit is not paid, because it cannot be
   * attributed and paying it from the depot's pool takes it from customers who ARE
   * identified. This is what stops that being a silence: a manager sees the exposure, the
   * quantity and the courier, and rules on it.
   */
  private async queueUnidentifiedRefund(
    depotId: string,
    record: GallonReturnRecord,
    reason: string | null,
    actorId: string,
  ): Promise<void> {
    await this.approvals.create(
      {
        depotId,
        type: ApprovalType.DEPOSIT_REFUND,
        title: `Retur galon tanpa pelanggan (${record.quantity} galon)`,
        subjectRef: record.id,
        // The exposure, not a proposal: nothing was paid, and this is what would be.
        amountIdr: this.config.gallonDepositIdr(depotId) * record.quantity,
        payload: {
          returnId: record.id,
          quantity: record.quantity,
          depositRefunded: 0,
          unidentified: true,
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
      input.customerId ?? null,
    );
    if (depositRefunded > depositLeft) {
      throw new GallonOverReturnError(
        'deposit',
        depositRefunded,
        depositLeft,
        input.customerId ? 'customer' : 'depot',
      );
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
      input.customerId ?? null,
    );
    /*
     * CA-4-47: an unidentified return refunds NOTHING.
     *
     * `measureAgainstOutstanding` falls back to the DEPOT's totals when there is no
     * customer, so a handover with `customerId: null` was capped by everybody's gallons
     * rather than by this customer's — the deposit came out of the collective pool. Two
     * things follow, and both are wrong: the refund is not bounded by anything this person
     * ever paid, and the "excess" check passes as long as ANY gallons are out, so a return
     * from somebody who never took one looks legitimate.
     *
     * A deposit was taken FROM a customer. It cannot be paid back to a person nobody
     * named, out of money that belongs to the ones who were. The empties are still real,
     * so they are still recorded — the physical count and the stock ledger stay correct —
     * and the customer claims the deposit at the depot where they can be identified.
     *
     * Not a refusal: refusing the handover would leave the courier holding gallons the
     * depot has no record of, which is worse for everyone.
     */
    const identified = Boolean(input.customerId);
    const depositRefunded =
      condition === GallonCondition.GOOD && identified
        ? Math.min(this.config.gallonDepositIdr(depotId) * input.quantity, depositLeft)
        : 0;
    // MONEY-04: idempotent on the order, because the courier's handover travels through the
    // offline queue and that queue is at-least-once. A lost response — 15s timeout at the
    // door, a 502 mid-deploy — is retried on the next flush, and the old bare `create`
    // booked a SECOND refund for the same handover.
    //
    // The issue side has had this since I1, with a comment saying exactly why. Only the
    // refund half was left open, which is the half that pays money out.
    const { record, created } = await this.returns.createFromOrder({
      depotId,
      customerId: input.customerId ?? null,
      orderId: input.orderId,
      quantity: input.quantity,
      condition,
      depositRefunded,
      note: input.note ?? null,
      actorId: courierId,
    });
    // Already booked. Return the refund that actually happened, and queue nothing: a second
    // variance approval for one handover is a manager asked to rule on the same gallons twice.
    if (!created) return record;
    if (excessGallons > 0) {
      await this.queueVariance(depotId, excessGallons, record.id, courierId);
    }
    /*
     * CA-4-47: an unidentified GOOD return owes somebody a deposit, and this is the only
     * trace of it. Queued for a manager so the money is a decision with a name on it
     * rather than a silence — the same treatment a damaged return already gets.
     */
    if (condition === GallonCondition.GOOD && !identified) {
      await this.queueUnidentifiedRefund(depotId, record, input.note ?? null, courierId);
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
