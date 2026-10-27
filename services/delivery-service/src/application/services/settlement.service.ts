import { Inject, Injectable, Logger } from '@nestjs/common';

import { can } from '@hydromart/access';
import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import {
  SettlementAlreadyExistsError,
  SettlementChargeNeedsManagerError,
  SettlementChargePendingError,
  SettlementChargeSelfApprovalError,
  SettlementChargeUndeliverableError,
  SettlementNoChargePendingError,
  SettlementNotFoundError,
  SettlementNotSubmittedError,
  SettlementSurplusNoteRequiredError,
  SettlementSyncError,
  ShiftNotEndedError,
  ShiftNotFoundError,
} from '../../domain/errors';
import {
  SettlementStatus,
  canResolve,
  computeVariance,
  isShortfall,
  surplusNeedsNote,
  appendNote,
} from '../../domain/settlement';
import { DeliveryStatus } from '../../domain/delivery-status';
import {
  DeliveryReportDataset,
  REPORT_TABLE_ROW_CAP,
  ReportTable,
} from '../../domain/report-table';
import { ShiftStatus } from '../../domain/shift';
import { CashCollectionPort } from '../ports/cash-collection.port';
import { CourierPayoutPort } from '../ports/courier-payout.port';
import { CodBearing, DeliveryRepository } from '../ports/delivery.repository';
import {
  DepositedCod,
  SettlementRecord,
  SettlementRepository,
} from '../ports/settlement.repository';
import { ShiftRepository } from '../ports/shift.repository';
import { DELIVERY_TOKENS } from '../tokens';
import { DeliveryConfigService } from '../../config/delivery-config.service';

export interface ResolveInput {
  chargedToDriver?: boolean;
  note?: string;
}

/** How far back the unsettled-COD read looks. */
export const UNSETTLED_DAYS = 30;

/** At most this many unfinished deliveries are checked against payment-service in one read. */
export const UNFINISHED_PROBE = 500;

/**
 * Cash couriers hold and no settlement covers yet, per courier (see SettlementService.unsettledCod).
 * `amountIdr` is the delivered COD plus `failedCashIdr`, the cash payment-service still reports as
 * PAID on deliveries handed back unfinished. `failedCashSource` says whether that second half
 * could be read: 'unavailable' means the totals are the delivered part only.
 */
export interface UnsettledCodReport {
  since: string;
  deliveries: number;
  amountIdr: number;
  failedCashIdr: number;
  failedCashSource: 'ok' | 'unavailable';
  couriers: {
    driverId: string;
    deliveries: number;
    amountIdr: number;
    failedCashIdr: number;
    oldestDeliveredAt: string;
  }[];
}

@Injectable()
export class SettlementService {
  private static readonly HISTORY_LIMIT = 30;
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.SettlementRepository)
    private readonly settlements: SettlementRepository,
    @Inject(DELIVERY_TOKENS.ShiftRepository) private readonly shifts: ShiftRepository,
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.CashCollection) private readonly cash: CashCollectionPort,
    @Inject(DELIVERY_TOKENS.CourierPayout) private readonly payout: CourierPayoutPort,
    private readonly config: DeliveryConfigService,
  ) {}

  /**
   * What ONE closed delivery adds to the expected deposit (CA-4-03).
   *
   * The two cases are not symmetric, and treating them as one is how this went wrong in
   * both directions at once:
   *
   *   DELIVERED            the goods left the van, so the COD is owed whether or not the
   *                        courier remembered to press "Terima uang". `max` covers the
   *                        skipped confirmation (C1) and also the order paid in cash
   *                        without a COD ever being written on the row.
   *
   *   FAILED, RESCHEDULED  nothing was handed over, so nothing is owed BY DEFAULT — using
   *                        `codAmount` here would invent a debt out of a delivery that
   *                        never happened, and charge the courier for it. What IS owed is
   *                        exactly the cash payment-service still reports as PAID: money
   *                        the courier took at the door and did not give back.
   *
   * That last clause is the owner's decision of 2 September 2026 (D1) made arithmetic. A
   * courier who hands the cash back at the door records it, the payment goes REFUNDED, and
   * it stops being PAID — so it drops out of this sum on its own, with the reversal written
   * in the payment book rather than in a flag on the delivery. A courier who keeps the
   * money is still holding it, the payment is still PAID, and the deposit still asks for it.
   */
  private owedFor(delivery: CodBearing, paidCash: number): number {
    return delivery.status === DeliveryStatus.DELIVERED
      ? Math.max(delivery.codAmount ?? 0, paidCash)
      : paidCash;
  }

  /**
   * Courier deposits their shift's cash (design 2d). The expected total is snapshotted
   * here, so a later refund can't move the debt, and fails closed if payment-service is
   * unreachable (never understate the expected).
   *
   * C1: "expected" is what the courier SHOULD be holding, not what the payment book was
   * told. Proof of delivery writes the proof and advances the order but never confirms
   * the payment — deliberately, so a payment-service outage can never burn a handover
   * that already happened (H-8). The consequence was that a courier who collected the
   * cash and skipped "Terima uang" settled against an expected of zero: no shortfall, no
   * dispute, no trace. So each order is worth `max(codAmount, cash PAID)` — per order,
   * because a shift can hold both an unconfirmed COD and an unrelated cash payment, and
   * one aggregate max would report only the larger of the two.
   *
   * CA-4-03: and it is every delivery the courier CLOSED in the window, not only the ones
   * that ended DELIVERED. See `owedFor` for why the two are not worth the same.
   */
  /**
   * What this shift's deposit will be measured against. Fails CLOSED — an unreachable
   * payment-service must never understate the expected.
   *
   * CA-4-16 split this out of `submit`. The number was computed at the moment the courier
   * pressed the button and nowhere else, so the one screen where it decides whether money
   * comes out of their pay never showed it.
   */
  private async expectedFor(
    driverId: string,
    shift: { id: string; depotId: string | null; checkInAt: Date; checkOutAt: Date },
    authorization: string,
  ): Promise<{ expectedAmount: number; orderIds: string[] }> {
    const closed = await this.deliveries.codBearingInWindow(
      driverId,
      shift.checkInAt,
      shift.checkOutAt,
    );
    const orderIds = closed.map((d) => d.orderId);
    try {
      const collected = await this.cash.sumCollected(orderIds, authorization);
      const paid = new Map(collected.byOrder.map((r) => [r.orderId, r.amountIdr]));
      return {
        expectedAmount: Math.round(
          this.config.settlementExpectFromCod(shift.depotId)
            ? closed.reduce((sum, d) => sum + this.owedFor(d, paid.get(d.orderId) ?? 0), 0)
            : collected.total,
        ),
        orderIds,
      };
    } catch (error) {
      this.logger.error(
        `cash-collected read failed for shift ${shift.id}: ${(error as Error).message}`,
      );
      throw new SettlementSyncError();
    }
  }

  /**
   * CA-4-16 — the total the courier is about to be measured against, BEFORE they hand the
   * cash over.
   *
   * The deposit screen asked for an amount and showed only what the courier had typed. The
   * number it is checked against was computed at submit time and never displayed, and any
   * shortfall is debited from their pay — so the one figure that decides whether money
   * comes out of their wages was the one figure they could not see.
   *
   * Same computation as `submit`, same fail-closed rule: a payment-service outage refuses
   * rather than showing a smaller, comforting number.
   */
  async expectedForShift(
    driverId: string,
    shiftId: string,
    authorization: string,
  ): Promise<{ shiftId: string; expectedIdr: number }> {
    const shift = await this.shifts.findById(shiftId);
    if (!shift || shift.driverId !== driverId) {
      throw new ShiftNotFoundError();
    }
    if (shift.status !== ShiftStatus.ENDED || !shift.checkOutAt) {
      throw new ShiftNotEndedError();
    }
    const { expectedAmount } = await this.expectedFor(
      driverId,
      { ...shift, checkOutAt: shift.checkOutAt },
      authorization,
    );
    return { shiftId, expectedIdr: expectedAmount };
  }

  async submit(
    driverId: string,
    shiftId: string,
    depositedAmount: number,
    authorization: string,
  ): Promise<SettlementRecord> {
    const shift = await this.shifts.findById(shiftId);
    if (!shift || shift.driverId !== driverId) {
      throw new ShiftNotFoundError();
    }
    if (shift.status !== ShiftStatus.ENDED || !shift.checkOutAt) {
      throw new ShiftNotEndedError();
    }
    if (await this.settlements.findByShift(shiftId)) {
      throw new SettlementAlreadyExistsError();
    }

    const { expectedAmount, orderIds } = await this.expectedFor(
      driverId,
      { ...shift, checkOutAt: shift.checkOutAt },
      authorization,
    );

    const deposited = Math.round(depositedAmount);
    const settlement = await this.settlements.create({
      shiftId,
      driverId,
      depotId: shift.depotId,
      orderIds,
      expectedAmount,
      depositedAmount: deposited,
      variance: computeVariance(expectedAmount, deposited),
    });
    this.logger.log(
      `Settlement ${settlement.id} submitted for shift ${shiftId}: expected ${expectedAmount}, deposited ${deposited}`,
    );
    return settlement;
  }

  /**
   * Cashier accepts the deposit (design 6a). A shortfall may be charged to the courier.
   *
   * C1: a surplus over the threshold needs a note first. `note` already existed on the
   * input and `verify` already wrote it — all that changes is that it becomes
   * conditionally required. No new column, no migration, and no new status: DISPUTED has
   * no way back out (C10), so sending surplus there would hang the money for good.
   */
  async verify(
    user: AuthenticatedUser,
    id: string,
    input: ResolveInput,
  ): Promise<SettlementRecord> {
    const actorId = user.sub;
    const settlement = await this.resolvable(id, user);
    if (settlement.chargeRequestedBy) throw new SettlementChargePendingError();
    const note = input.note?.trim() ? input.note.trim() : null;
    if (surplusNeedsNote(settlement.variance) && note === null) {
      throw new SettlementSurplusNoteRequiredError();
    }
    // C10: ending a dispute always needs a written reason, whatever the variance was. The
    // deposit was parked BECAUSE somebody could not sign it off; closing that silently
    // leaves no account of what changed between the two decisions.
    const wasDisputed = settlement.status === SettlementStatus.DISPUTED;
    if (wasDisputed && note === null) {
      throw new SettlementSurplusNoteRequiredError();
    }
    // Only a genuine shortfall can be charged; an exact or over deposit never is. The
    // surplus rule above is about leaving a trace, NOT about billing: it must never make
    // a surplus chargeable.
    const charged = (input.chargedToDriver ?? false) && isShortfall(settlement.variance);
    /*
     * Owner decision 2026-10-16: a shortfall charge needs a SECOND person. Raising it only
     * parks it; `approveCharge` (a different approvals-capable user) posts it. Gated on
     * `charged`, not on what was typed: a surplus with the box ticked charges nothing and
     * must not be parked. Plain verify/dispute stay single-person.
     */
    if (charged) {
      const raised = wasDisputed && note ? appendNote(settlement.note, note) : note;
      this.logger.log(`Settlement ${id} charge raised by ${actorId}, awaiting approval`);
      return this.settlements.requestCharge(id, actorId, raised);
    }
    this.logger.log(`Settlement ${id} verified by ${actorId} (chargedToDriver=false)`);
    return this.settlements.resolve(id, {
      status: SettlementStatus.VERIFIED,
      chargedToDriver: false,
      // C10: keep WHY it was disputed next to HOW it ended — one column, both facts.
      note: wasDisputed && note ? appendNote(settlement.note, note) : note,
      verifiedBy: actorId,
      verifiedAt: new Date(),
    });
  }

  /** A pending charge, readable and decidable by this user; `approvals` capability only. */
  private async pendingCharge(user: AuthenticatedUser, id: string): Promise<SettlementRecord> {
    const settlement = await this.resolvable(id, user);
    if (!can('approvals', user.role)) throw new SettlementChargeNeedsManagerError();
    if (!settlement.chargeRequestedBy) throw new SettlementNoChargePendingError();
    return settlement;
  }

  /**
   * Second person approves a raised shortfall charge. Never the raiser (SUPER_ADMIN may be
   * raiser or approver, but still not both on one charge).
   *
   * CA-2-32: the debit is posted BEFORE the settlement claims it was, and a push that does
   * not land refuses the approval — the charge stays pending, and the push is idempotent
   * by settlement id, so retrying is safe whether or not the first attempt reached payout.
   */
  async approveCharge(user: AuthenticatedUser, id: string): Promise<SettlementRecord> {
    const settlement = await this.pendingCharge(user, id);
    if (settlement.chargeRequestedBy === user.sub) throw new SettlementChargeSelfApprovalError();
    const posted = await this.payout.cashVarianceCharged({
      courierId: settlement.driverId,
      depotId: settlement.depotId,
      settlementId: settlement.id,
      amount: Math.abs(settlement.variance),
    });
    if (!posted) throw new SettlementChargeUndeliverableError();
    this.logger.log(
      `Settlement ${id} charge raised by ${settlement.chargeRequestedBy} approved by ${user.sub}`,
    );
    return this.settlements.resolve(id, {
      status: SettlementStatus.VERIFIED,
      chargedToDriver: true,
      note: settlement.note,
      verifiedBy: user.sub,
      verifiedAt: new Date(),
    });
  }

  /** Reject a raised charge: back to the queue uncharged, with the reason kept in the note. */
  async rejectCharge(
    user: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<SettlementRecord> {
    const settlement = await this.pendingCharge(user, id);
    this.logger.log(
      `Settlement ${id} charge raised by ${settlement.chargeRequestedBy} rejected by ${user.sub}`,
    );
    return this.settlements.clearChargeRequest(
      id,
      appendNote(settlement.note, `Pembebanan ditolak: ${reason.trim()}`),
    );
  }

  /** Cashier disputes the deposit (design 6a): parks it for offline resolution. */
  async dispute(user: AuthenticatedUser, id: string, note: string): Promise<SettlementRecord> {
    const actorId = user.sub;
    const settlement = await this.resolvable(id, user);
    if (settlement.chargeRequestedBy) throw new SettlementChargePendingError();
    this.logger.log(`Settlement ${id} disputed by ${actorId}`);
    return this.settlements.resolve(id, {
      status: SettlementStatus.DISPUTED,
      chargedToDriver: false,
      note,
      verifiedBy: actorId,
      verifiedAt: new Date(),
    });
  }

  async listForDriver(driverId: string): Promise<SettlementRecord[]> {
    return this.settlements.listByDriver(driverId, SettlementService.HISTORY_LIMIT);
  }

  async getForDriver(driverId: string, id: string): Promise<SettlementRecord> {
    const settlement = await this.settlements.findById(id);
    // A settlement that is not this courier's is reported missing, not forbidden.
    if (!settlement || settlement.driverId !== driverId) {
      throw new SettlementNotFoundError();
    }
    return settlement;
  }

  /**
   * What the couriers of a depot delivered as cash-on-delivery in the last `UNSETTLED_DAYS`
   * days and have not handed in: no settlement lists those orders yet.
   *
   * It is the COD RECORDED on delivered orders, not a count of cash in anyone's pocket: cash a
   * courier took on a failed or rescheduled delivery sits in payment-service, which this read
   * does not ask. The window bounds the query, so an old delivery nobody ever settled drops off
   * after a month rather than growing the answer forever; it is still in the settlement queue.
   */
  async unsettledCod(
    depotId: string,
    authorization = '',
    now: Date = new Date(),
  ): Promise<UnsettledCodReport> {
    const since = new Date(now.getTime() - UNSETTLED_DAYS * 86_400_000);
    const [delivered, unfinished] = await Promise.all([
      this.deliveries.unsettledCod(depotId, since),
      this.deliveries.unsettledUnfinished(depotId, since, UNFINISHED_PROBE),
    ]);

    // Cash taken on a delivery that was then handed back: only payment-service knows. A courier who
    // gave it back at the door has it REFUNDED and it drops out on its own (owner decision D1).
    const held = new Map<string, { n: number; amount: number; oldest: Date }>();
    let failedCashSource: 'ok' | 'unavailable' = 'ok';
    if (unfinished.length > 0) {
      try {
        const collected = await this.cash.sumCollected(
          unfinished.map((u) => u.orderId),
          authorization,
        );
        const paid = new Map(collected.byOrder.map((o) => [o.orderId, o.amountIdr]));
        for (const u of unfinished) {
          const amount = paid.get(u.orderId) ?? 0;
          if (amount <= 0) continue;
          const cur = held.get(u.driverId);
          held.set(u.driverId, {
            n: (cur?.n ?? 0) + 1,
            amount: (cur?.amount ?? 0) + amount,
            oldest: cur && cur.oldest.getTime() < u.at.getTime() ? cur.oldest : u.at,
          });
        }
      } catch (error) {
        // Not guessed and not hidden: the delivered half is still true, and the report says the
        // other half could not be read.
        this.logger.error('unfinished-delivery cash read failed: ' + (error as Error).message);
        failedCashSource = 'unavailable';
      }
    }

    const byDriver = new Map<string, UnsettledCodReport['couriers'][number]>();
    for (const r of delivered) {
      byDriver.set(r.driverId, {
        driverId: r.driverId,
        deliveries: r.deliveries,
        amountIdr: r.amountIdr,
        failedCashIdr: 0,
        oldestDeliveredAt: r.oldestDeliveredAt.toISOString(),
      });
    }
    for (const [driverId, h] of held) {
      const cur = byDriver.get(driverId);
      const oldest =
        cur && Date.parse(cur.oldestDeliveredAt) < h.oldest.getTime()
          ? cur.oldestDeliveredAt
          : h.oldest.toISOString();
      byDriver.set(driverId, {
        driverId,
        deliveries: (cur?.deliveries ?? 0) + h.n,
        amountIdr: (cur?.amountIdr ?? 0) + h.amount,
        failedCashIdr: h.amount,
        oldestDeliveredAt: oldest,
      });
    }
    const couriers = [...byDriver.values()].sort(
      (a, b) => b.amountIdr - a.amountIdr || a.driverId.localeCompare(b.driverId),
    );
    return {
      since: since.toISOString(),
      deliveries: couriers.reduce((n, c) => n + c.deliveries, 0),
      amountIdr: couriers.reduce((n, c) => n + c.amountIdr, 0),
      failedCashIdr: couriers.reduce((n, c) => n + c.failedCashIdr, 0),
      failedCashSource,
      couriers,
    };
  }

  /**
   * The rows behind a scheduled report (admin-service), as one flat table.
   *
   * COD_UNSETTLED is the DELIVERED half of `unsettledCod` for the whole network: cash recorded on
   * deliveries made in [until - UNSETTLED_DAYS, until) that no settlement lists, per courier and
   * depot. Cash taken on handed-back deliveries is not here, because payment-service wants a
   * bearer and a scheduler holds none. Couriers and depots are refs: this service stores no names.
   */
  async reportTable(dataset: DeliveryReportDataset, from: Date, to: Date): Promise<ReportTable> {
    const limit = REPORT_TABLE_ROW_CAP + 1;
    if (dataset === DeliveryReportDataset.COD_UNSETTLED) {
      const since = new Date(to.getTime() - UNSETTLED_DAYS * 86_400_000);
      const all = await this.deliveries.codHeldByCourier(since, to, limit);
      return {
        columns: [
          { key: 'courier', label: 'Kurir', type: 'text' },
          { key: 'depot', label: 'Depot', type: 'text' },
          { key: 'deliveries', label: 'Pengiriman', type: 'int' },
          { key: 'amount', label: 'COD ditahan', type: 'money' },
          { key: 'oldest', label: 'Pengiriman tertua', type: 'date' },
          { key: 'ageDays', label: 'Umur (hari)', type: 'int' },
        ],
        rows: all.slice(0, REPORT_TABLE_ROW_CAP).map((r) => [
          r.driverId,
          r.depotId,
          r.deliveries,
          r.amountIdr,
          r.oldestDeliveredAt.toISOString(),
          Math.max(0, Math.floor((to.getTime() - r.oldestDeliveredAt.getTime()) / 86_400_000)),
        ]),
        truncated: all.length > REPORT_TABLE_ROW_CAP,
      };
    }
    const all = await this.deliveries.failedInWindow(from, to, limit);
    return {
      columns: [
        { key: 'at', label: 'Tanggal', type: 'date' },
        { key: 'order', label: 'No. pesanan', type: 'text' },
        { key: 'courier', label: 'Kurir', type: 'text' },
        { key: 'depot', label: 'Depot', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'reason', label: 'Alasan', type: 'text' },
      ],
      rows: all.slice(0, REPORT_TABLE_ROW_CAP).map((r) => [
        r.at.toISOString(),
        r.orderNumber,
        r.driverId,
        r.depotId,
        r.status === DeliveryStatus.FAILED ? 'Gagal' : 'Dijadwalkan ulang',
        r.reason,
      ]),
      truncated: all.length > REPORT_TABLE_ROW_CAP,
    };
  }
  /** Cashier queue for a depot, optionally filtered by status. */
  async searchForDepot(depotId: string, status?: SettlementStatus): Promise<SettlementRecord[]> {
    return this.settlements.search({ depotId, status });
  }

  /**
   * COD a depot accepted in [from, to). Read by depot-service when it closes the day's
   * books: counter cash posts itself into the cashbook, courier COD does not, so without
   * this the day's takings are only half the money.
   */
  async depositedForDepot(depotId: string, from: Date, to: Date): Promise<DepositedCod> {
    return this.settlements.depositedInWindow(depotId, from, to);
  }

  private async resolvable(id: string, user: AuthenticatedUser): Promise<SettlementRecord> {
    const settlement = await this.settlements.findById(id);
    if (!settlement) {
      throw new SettlementNotFoundError();
    }
    // Close the by-id vector: a depot-locked cashier may only resolve their own depot's settlement.
    assertDepotAccess(user, settlement.depotId);
    if (!canResolve(settlement.status)) {
      throw new SettlementNotSubmittedError();
    }
    return settlement;
  }
}
