import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import {
  SettlementAlreadyExistsError,
  SettlementChargeUndeliverableError,
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

    const closed = await this.deliveries.codBearingInWindow(
      driverId,
      shift.checkInAt,
      shift.checkOutAt,
    );
    const orderIds = closed.map((d) => d.orderId);

    let expectedAmount: number;
    try {
      const collected = await this.cash.sumCollected(orderIds, authorization);
      const paid = new Map(collected.byOrder.map((r) => [r.orderId, r.amountIdr]));
      expectedAmount = this.config.settlementExpectFromCod(shift.depotId)
        ? closed.reduce((sum, d) => sum + this.owedFor(d, paid.get(d.orderId) ?? 0), 0)
        : Math.round(collected.total);
      expectedAmount = Math.round(expectedAmount);
    } catch (error) {
      this.logger.error(
        `cash-collected read failed for shift ${shiftId}: ${(error as Error).message}`,
      );
      throw new SettlementSyncError();
    }

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
     * CA-2-32: the debit is posted BEFORE the settlement claims it was, and a push that
     * does not land refuses the verify.
     *
     * It used to be `void this.payout.cashVarianceCharged(...)` after the write — a charge
     * fired at a service that might be down, from a row that already said the courier had
     * been charged. Nothing reconciled the two, so a payout outage silently forgave the
     * shortfall while the paperwork said it had been collected.
     *
     * Refusing loses nothing: the settlement stays awaiting a ruling, and the push is
     * idempotent by settlement id, so pressing verify again is safe whether the first
     * attempt reached payout or not.
     */
    if (charged) {
      const posted = await this.payout.cashVarianceCharged({
        courierId: settlement.driverId,
        depotId: settlement.depotId,
        settlementId: settlement.id,
        amount: Math.abs(settlement.variance),
      });
      if (!posted) throw new SettlementChargeUndeliverableError();
    }
    this.logger.log(`Settlement ${id} verified by ${actorId} (chargedToDriver=${charged})`);
    const resolved = await this.settlements.resolve(id, {
      status: SettlementStatus.VERIFIED,
      chargedToDriver: charged,
      // C10: keep WHY it was disputed next to HOW it ended — one column, both facts.
      note: wasDisputed && note ? appendNote(settlement.note, note) : note,
      verifiedBy: actorId,
      verifiedAt: new Date(),
    });
    return resolved;
  }

  /** Cashier disputes the deposit (design 6a): parks it for offline resolution. */
  async dispute(user: AuthenticatedUser, id: string, note: string): Promise<SettlementRecord> {
    const actorId = user.sub;
    await this.resolvable(id, user);
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
