import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  SettlementAlreadyExistsError,
  SettlementNotFoundError,
  SettlementNotSubmittedError,
  SettlementSyncError,
  ShiftNotEndedError,
  ShiftNotFoundError,
} from '../../domain/errors';
import { SettlementStatus, canResolve, computeVariance, isShortfall } from '../../domain/settlement';
import { ShiftStatus } from '../../domain/shift';
import { CashCollectionPort } from '../ports/cash-collection.port';
import { CourierPayoutPort } from '../ports/courier-payout.port';
import { DeliveryRepository } from '../ports/delivery.repository';
import { SettlementRecord, SettlementRepository } from '../ports/settlement.repository';
import { ShiftRepository } from '../ports/shift.repository';
import { DELIVERY_TOKENS } from '../tokens';

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
  ) {}

  /**
   * Courier deposits their shift's cash (design 2d). The expected total is the PAID
   * cash over every order delivered in the shift window, read live from
   * payment-service and snapshotted here — so a later refund can't move the debt.
   * Fails closed if payment-service is unreachable (never understate the expected).
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

    const orderIds = await this.deliveries.deliveredOrderIdsInWindow(
      driverId,
      shift.checkInAt,
      shift.checkOutAt,
    );

    let expectedAmount: number;
    try {
      const collected = await this.cash.sumCollected(orderIds, authorization);
      expectedAmount = Math.round(collected.total);
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

  /** Cashier accepts the deposit (design 6a). A shortfall may be charged to the courier. */
  async verify(actorId: string, id: string, input: ResolveInput): Promise<SettlementRecord> {
    const settlement = await this.resolvable(id);
    // Only a genuine shortfall can be charged; an exact or over deposit never is.
    const charged = (input.chargedToDriver ?? false) && isShortfall(settlement.variance);
    this.logger.log(`Settlement ${id} verified by ${actorId} (chargedToDriver=${charged})`);
    const resolved = await this.settlements.resolve(id, {
      status: SettlementStatus.VERIFIED,
      chargedToDriver: charged,
      note: input.note ?? null,
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
  async dispute(actorId: string, id: string, note: string): Promise<SettlementRecord> {
    await this.resolvable(id);
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

  private async resolvable(id: string): Promise<SettlementRecord> {
    const settlement = await this.settlements.findById(id);
    if (!settlement) {
      throw new SettlementNotFoundError();
    }
    if (!canResolve(settlement.status)) {
      throw new SettlementNotSubmittedError();
    }
    return settlement;
  }
}
