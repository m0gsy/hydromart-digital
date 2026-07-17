import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DeliveryAlreadyExistsError,
  DeliveryNotActiveError,
  DeliveryNotFoundError,
  DriverBusyError,
  DriverNotOnShiftError,
  InvalidDeliveryTransitionError,
  NoShowNotEligibleError,
  NotAssignedDriverError,
  OrderCoordinationError,
} from '../../domain/errors';
import {
  DeliveryStatus,
  OrderFulfilmentStatus,
  canTransition,
  isActive,
  orderStatusFor,
} from '../../domain/delivery-status';
import {
  ContactMethod,
  NoShowPolicy,
  canMarkNoShow,
  noShowEligibleAt,
} from '../../domain/no-show';
import { DeliveryConfigService } from '../../config/delivery-config.service';
import { Page, buildPage } from '../pagination';
import {
  CreateDeliveryData,
  DeliveryRecord,
  DeliveryRepository,
  DeliveryTimestamps,
  ProofRecord,
} from '../ports/delivery.repository';
import { OrderCoordinationPort } from '../ports/order-coordination.port';
import { CourierPayoutPort } from '../ports/courier-payout.port';
import { ShiftService } from './shift.service';
import { DELIVERY_TOKENS } from '../tokens';

export interface AssignInput {
  orderId: string;
  orderNumber: string;
  driverId: string;
  driverName?: string;
  depotId?: string;
  destinationAddress: string;
  destinationLat?: number;
  destinationLng?: number;
}

export type ProofInput = Omit<ProofRecord, 'capturedAt'>;

export interface ListDeliveriesInput {
  status?: DeliveryStatus;
  page?: number;
  limit?: number;
}

/** No-show gate view for the app timer (design 5a). */
export interface NoShowStatus {
  attempts: number;
  eligibleAt: Date | null;
  canMarkNoShow: boolean;
}

export interface RescheduleInput {
  rescheduledFor: Date;
  slot?: string;
  note?: string;
}

@Injectable()
export class DeliveryService {
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.OrderCoordination) private readonly orders: OrderCoordinationPort,
    @Inject(DELIVERY_TOKENS.CourierPayout) private readonly payout: CourierPayoutPort,
    private readonly shifts: ShiftService,
    private readonly config: DeliveryConfigService,
  ) {}

  /**
   * Assigns a driver to an order (staff). Enforces one delivery per order, that the
   * driver is checked in and ONLINE, and the per-driver active-delivery cap (BR: one
   * driver = one active order). The order is advanced to DRIVER_ASSIGNED on
   * order-service first (which validates BR-012); the delivery is then recorded.
   */
  async assign(
    actorId: string,
    input: AssignInput,
    authorization: string,
  ): Promise<DeliveryRecord> {
    if (await this.deliveries.findByOrder(input.orderId)) {
      throw new DeliveryAlreadyExistsError();
    }
    // Every delivery must fall inside exactly one shift, or the end-of-shift COD
    // settlement has orders it cannot account for. No shift, no assignment.
    if (!(await this.shifts.isAvailable(input.driverId))) {
      throw new DriverNotOnShiftError();
    }
    const active = await this.deliveries.countActiveByDriver(input.driverId);
    if (active >= this.config.maxActiveDeliveriesPerDriver) {
      throw new DriverBusyError();
    }

    await this.advanceOrder(input.orderId, 'DRIVER_ASSIGNED', authorization, input.driverName);

    const data: CreateDeliveryData = {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      driverId: input.driverId,
      depotId: input.depotId ?? null,
      destinationAddress: input.destinationAddress,
      destinationLat: input.destinationLat ?? null,
      destinationLng: input.destinationLng ?? null,
    };
    const delivery = await this.deliveries.create(data);
    this.logger.log(`Delivery ${delivery.id} assigned to driver ${input.driverId} by ${actorId}`);
    return delivery;
  }

  async pickup(driverId: string, id: string, authorization: string): Promise<DeliveryRecord> {
    return this.advance(
      driverId,
      id,
      DeliveryStatus.PICKED_UP,
      { pickedUpAt: new Date() },
      authorization,
    );
  }

  async start(driverId: string, id: string, authorization: string): Promise<DeliveryRecord> {
    return this.advance(
      driverId,
      id,
      DeliveryStatus.ON_DELIVERY,
      { startedAt: new Date() },
      authorization,
    );
  }

  /** Completes the delivery with mandatory proof (photo + GPS + timestamp + signature). */
  async complete(
    driverId: string,
    id: string,
    proof: ProofInput,
    authorization: string,
  ): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.DELIVERED);
    await this.advanceOrder(delivery.orderId, 'DELIVERED', authorization);
    const completed = await this.deliveries.completeWithProof(id, proof, driverId);
    this.logger.log(`Delivery ${id} completed by driver ${driverId}`);
    // Credit the courier's earnings (design 6b). Fail-open + idempotent: a completed
    // delivery must never roll back because its earning push did.
    void this.pushEarning(completed);
    return completed;
  }

  /** Reports a completed delivery to payout-service. On-time = beat the SLA window. */
  private async pushEarning(delivery: DeliveryRecord): Promise<void> {
    if (!delivery.deliveredAt) return;
    const minutes = (delivery.deliveredAt.getTime() - delivery.assignedAt.getTime()) / 60000;
    await this.payout.deliveryCompleted({
      courierId: delivery.driverId,
      depotId: delivery.depotId,
      deliveryId: delivery.id,
      deliveredAt: delivery.deliveredAt.toISOString(),
      onTime: minutes <= this.config.slaMinutes,
    });
  }

  /** Marks the delivery failed (does not change the order status). */
  async fail(driverId: string, id: string, reason: string): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.FAILED);
    this.logger.warn(`Delivery ${id} failed by driver ${driverId}: ${reason}`);
    return this.deliveries.applyStatus(
      id,
      DeliveryStatus.FAILED,
      { failedAt: new Date(), failureReason: reason },
      driverId,
      reason,
    );
  }

  /**
   * Records a contact attempt (design 5a) and returns the no-show gate status the
   * app timer shows. Only allowed while the delivery is still in progress.
   */
  async recordContactAttempt(
    driverId: string,
    id: string,
    method: ContactMethod,
    note?: string,
    now: Date = new Date(),
  ): Promise<NoShowStatus> {
    const delivery = await this.ownedByDriver(driverId, id);
    if (!isActive(delivery.status)) {
      throw new DeliveryNotActiveError();
    }
    const state = await this.deliveries.recordContactAttempt(id, driverId, method, note ?? null);
    return {
      attempts: state.attempts,
      eligibleAt: noShowEligibleAt(state, this.noShowPolicy),
      canMarkNoShow: canMarkNoShow(state, this.noShowPolicy, now),
    };
  }

  /**
   * Fails the delivery as a no-show (design 5a), only once the contact-attempt +
   * wait gate is satisfied. Recorded as a FAILED with a no-show reason.
   */
  async markNoShow(driverId: string, id: string, now: Date = new Date()): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.FAILED);
    const state = await this.deliveries.contactState(id);
    if (!canMarkNoShow(state, this.noShowPolicy, now)) {
      throw new NoShowNotEligibleError(
        this.config.noShowMinContactAttempts,
        this.config.noShowMinWaitSeconds,
      );
    }
    const reason = 'Pelanggan tidak di tempat (no-show).';
    this.logger.warn(`Delivery ${id} failed as no-show by driver ${driverId}`);
    return this.deliveries.applyStatus(
      id,
      DeliveryStatus.FAILED,
      { failedAt: new Date(), failureReason: reason },
      driverId,
      reason,
    );
  }

  /**
   * Reschedules the delivery to a later slot (design 3c). The delivery goes
   * RESCHEDULED (non-active, frees the driver) and the order is NOT advanced —
   * dispatch re-assigns it later. The customer notice is best-effort.
   */
  async reschedule(driverId: string, id: string, input: RescheduleInput): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.RESCHEDULED);
    const updated = await this.deliveries.applyStatus(
      id,
      DeliveryStatus.RESCHEDULED,
      {
        rescheduledFor: input.rescheduledFor,
        rescheduleSlot: input.slot ?? null,
        rescheduleNote: input.note ?? null,
      },
      driverId,
      input.note ?? null,
    );
    // ponytail: best-effort customer notice, logged for now. The real crm push
    // (customer notification feed) is wired in slice 6 when crm plumbing lands.
    this.logger.log(
      `Delivery ${id} rescheduled to ${input.rescheduledFor.toISOString()} — customer notice pending (slice 6 crm)`,
    );
    return updated;
  }

  private get noShowPolicy(): NoShowPolicy {
    return {
      minAttempts: this.config.noShowMinContactAttempts,
      minWaitSeconds: this.config.noShowMinWaitSeconds,
    };
  }

  /**
   * Records the driver's latest position for live tracking (PRD 10a). Only the
   * assigned driver may ping, and only while the delivery is still in progress
   * (a delivered/failed delivery no longer moves). Latest position overwrites the
   * previous one — no track history is kept in the MVP.
   */
  async reportLocation(driverId: string, id: string, lat: number, lng: number): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    if (!isActive(delivery.status)) {
      throw new DeliveryNotActiveError();
    }
    return this.deliveries.updateLocation(id, lat, lng);
  }

  async getForDriver(driverId: string, id: string): Promise<DeliveryRecord> {
    const delivery = await this.deliveries.findById(id);
    if (!delivery || delivery.driverId !== driverId) {
      throw new DeliveryNotFoundError();
    }
    return delivery;
  }

  async getAny(id: string): Promise<DeliveryRecord> {
    const delivery = await this.deliveries.findById(id);
    if (!delivery) {
      throw new DeliveryNotFoundError();
    }
    return delivery;
  }

  async listForDriver(driverId: string, input: ListDeliveriesInput): Promise<Page<DeliveryRecord>> {
    return this.search({ ...input, driverId });
  }

  async listAll(input: ListDeliveriesInput): Promise<Page<DeliveryRecord>> {
    return this.search(input);
  }

  /**
   * UU PDP retention sweep: delete proof-of-delivery records older than the
   * configured window (default 12 months). Invoked by the internal scheduler.
   * Image files are expired separately by an object-storage bucket lifecycle rule.
   */
  async purgeExpiredProofs(now: Date = new Date()): Promise<{ purged: number }> {
    const cutoff = new Date(now.getTime() - this.config.podRetentionDays * 86_400_000);
    const purged = await this.deliveries.purgeProofsBefore(cutoff);
    if (purged > 0) {
      this.logger.log(`Purged ${purged} proof-of-delivery record(s) older than ${cutoff.toISOString()}`);
    }
    return { purged };
  }

  private async advance(
    driverId: string,
    id: string,
    to: DeliveryStatus,
    timestamps: DeliveryTimestamps,
    authorization: string,
  ): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, to);
    const orderStatus = orderStatusFor(to);
    if (orderStatus) {
      await this.advanceOrder(delivery.orderId, orderStatus, authorization);
    }
    return this.deliveries.applyStatus(id, to, timestamps, driverId, null);
  }

  private async ownedByDriver(driverId: string, id: string): Promise<DeliveryRecord> {
    const delivery = await this.getAny(id);
    if (delivery.driverId !== driverId) {
      throw new NotAssignedDriverError();
    }
    return delivery;
  }

  private assertTransition(from: DeliveryStatus, to: DeliveryStatus): void {
    if (!canTransition(from, to)) {
      throw new InvalidDeliveryTransitionError(from, to);
    }
  }

  // ponytail: no cross-service transaction — order-service is advanced first
  // (it validates BR-012), then the delivery is persisted locally. A failure
  // between the two is logged and surfaced; local persistence shares one DB and
  // effectively never half-commits.
  private async advanceOrder(
    orderId: string,
    status: OrderFulfilmentStatus,
    authorization: string,
    driverName?: string,
  ): Promise<void> {
    try {
      await this.orders.advanceStatus(orderId, status, authorization, driverName);
    } catch (error) {
      this.logger.error(
        `Order sync to ${status} failed for order ${orderId}: ${(error as Error).message}`,
      );
      throw new OrderCoordinationError();
    }
  }

  private async search(
    input: ListDeliveriesInput & { driverId?: string },
  ): Promise<Page<DeliveryRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(DeliveryService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total } = await this.deliveries.search({
      page,
      limit,
      driverId: input.driverId,
      status: input.status,
    });
    return buildPage(items, total, page, limit);
  }
}
