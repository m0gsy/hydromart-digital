import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import {
  SettlementAlreadyExistsError,
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
} from '../../domain/settlement';
import { ShiftStatus } from '../../domain/shift';
import { CashCollectionPort } from '../ports/cash-collection.port';
import { CourierPayoutPort } from '../ports/courier-payout.port';
import { DeliveryRepository } from '../ports/delivery.repository';
import { DepositedCod, SettlementRecord, SettlementRepository } from '../ports/settlement.repository';
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

    const delivered = await this.deliveries.deliveredCodInWindow(
      driverId,
      shift.checkInAt,
      shift.checkOutAt,
    );
    const orderIds = delivered.map((d) => d.orderId);

    let expectedAmount: number;
    try {
      const collected = await this.cash.sumCollected(orderIds, authorization);
      const paid = new Map(collected.byOrder.map((r) => [r.orderId, r.amountIdr]));
      expectedAmount = this.config.settlementExpectFromCod(shift.depotId)
        ? delivered.reduce((sum, d) => sum + Math.max(d.codAmount ?? 0, paid.get(d.orderId) ?? 0), 0)
        : Math.round(collected.total);
      expectedAmount = Math.round(expectedAmount);
    } catch (error) {
      this.logger.error(`cash-collected read failed for shift ${shiftId}: ${(error as Error).message}`);
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
  async verify(user: AuthenticatedUser, id: string, input: ResolveInput): Promise<SettlementRecord> {
    const actorId = user.sub;
    const settlement = await this.resolvable(id, user);
    const note = input.note?.trim() ? input.note.trim() : null;
    if (surplusNeedsNote(settlement.variance) && note === null) {
      throw new SettlementSurplusNoteRequiredError();
    }
    // Only a genuine shortfall can be charged; an exact or over deposit never is. The
    // surplus rule above is about leaving a trace, NOT about billing: it must never make
    // a surplus chargeable.
    const charged = (input.chargedToDriver ?? false) && isShortfall(settlement.variance);
    this.logger.log(`Settlement ${id} verified by ${actorId} (chargedToDriver=${charged})`);
    const resolved = await this.settlements.resolve(id, {
      status: SettlementStatus.VERIFIED,
      chargedToDriver: charged,
      note,
      verifiedBy: actorId,
      verifiedAt: new Date(),
    });
    // Debit the courier's payout ledger for the shortfall (design 2d→2c). Fire-and-forget,
    // fail-open + idempotent by settlement id — the charge is already persisted here.
    if (charged) {
      void this.payout.cashVarianceCharged({
        courierId: resolved.driverId,
        depotId: resolved.depotId,
        settlementId: resolved.id,
        amount: Math.abs(resolved.variance),
      });
    }
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
