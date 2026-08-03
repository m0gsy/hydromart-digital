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
import { OrderAdvanceMeta, OrderCoordinationPort } from '../ports/order-coordination.port';
import { CourierPayoutPort } from '../ports/courier-payout.port';
import { DepotLocationPort } from '../ports/depot-location.port';
import { haversineMeters } from '../../domain/geo';
import { clampCapturedAt } from '../../domain/offline';
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
  recipientPhone?: string;
  driverPhone?: string;
  items?: { name: string; qty: number }[];
  codAmount?: number;
  notes?: string;
}

export type ProofInput = Omit<ProofRecord, 'capturedAt'> & {
  /** Device time when the proof was captured offline; absent for a live handover. */
  capturedAt?: Date | null;
};

export interface ListDeliveriesInput {
  status?: DeliveryStatus;
  page?: number;
  limit?: number;
  /** Depot scope for staff lists; set by the controller from depotScopeIds (undefined = all). */
  depotIds?: readonly string[];
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
  /** Forwarded so the order can be handed back to dispatch on the caller's behalf. */
  authorization?: string;
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
    @Inject(DELIVERY_TOKENS.DepotLocation) private readonly depots: DepotLocationPort,
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
    // One delivery row per order (orderId is unique). A RESCHEDULED row is the exception:
    // reschedule deliberately keeps the order alive for a second attempt, but the row was
    // terminal AND this guard refused a fresh assignment, so a rescheduled order could
    // never be delivered by anyone. Re-open that row instead of rejecting the dispatch.
    const existing = await this.deliveries.findByOrder(input.orderId);
    if (existing && existing.status !== DeliveryStatus.RESCHEDULED) {
      throw new DeliveryAlreadyExistsError();
    }
    // Every delivery must fall inside exactly one shift, or the end-of-shift COD
    // settlement has orders it cannot account for. No shift, no assignment.
    if (!(await this.shifts.isAvailable(input.driverId))) {
      throw new DriverNotOnShiftError();
    }
    const active = await this.deliveries.countActiveByDriver(input.driverId);
    if (active >= this.config.maxActiveDeliveriesPerDriver(input.depotId ?? null)) {
      throw new DriverBusyError();
    }

    const assignMeta: OrderAdvanceMeta | undefined =
      input.driverName || input.driverPhone
        ? { driverName: input.driverName, driverPhone: input.driverPhone }
        : undefined;
    await this.advanceOrder(input.orderId, 'DRIVER_ASSIGNED', authorization, assignMeta);

    const data: CreateDeliveryData = {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      driverId: input.driverId,
      depotId: input.depotId ?? null,
      destinationAddress: input.destinationAddress,
      destinationLat: input.destinationLat ?? null,
      destinationLng: input.destinationLng ?? null,
      recipientPhone: input.recipientPhone ?? null,
      items: input.items ?? null,
      codAmount: input.codAmount ?? null,
      notes: input.notes ?? null,
    };
    const delivery = existing
      ? await this.deliveries.reassign(
          existing.id,
          input.driverId,
          actorId,
          'Penugasan ulang setelah dijadwalkan ulang.',
        )
      : await this.deliveries.create(data);
    this.logger.log(
      `Delivery ${delivery.id} ${existing ? 're-assigned' : 'assigned'} to driver ${input.driverId} by ${actorId}`,
    );
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

  /** Completes the delivery with proof: photo + GPS + timestamp mandatory, signature optional. */
  async complete(
    driverId: string,
    id: string,
    proof: ProofInput,
    authorization: string,
  ): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.DELIVERED);
    // Proof queued offline keeps the handover time, floored at assignment so a wrong device
    // clock cannot fake an impossibly fast delivery and inflate the courier's on-time rate.
    const capturedAt = clampCapturedAt(
      proof.capturedAt,
      new Date(),
      this.config.offlineMaxAgeHours(delivery.depotId),
      delivery.assignedAt,
    );
    // H-8: the proof is written FIRST, and it is what makes the rest legitimate. The order
    // used to be marched to DELIVERED and then COMPLETED before this line ran, so a proof
    // write that failed left an order closed, its stock consumed, its points awarded and
    // its courier paid, with no evidence anyone had handed over anything.
    //
    // The status guard rides along: a re-tapped Selesai matches no row and raises rather
    // than paying the courier twice for one handover (H-5).
    const completed = await this.deliveries.completeWithProof(
      id,
      delivery.status,
      proof,
      driverId,
      capturedAt,
    );
    this.logger.log(`Delivery ${id} completed by driver ${driverId}`);
    // Proof of delivery is the real-world close of the order: nothing downstream of it is
    // staff- or customer-driven. Without this step the order sits at DELIVERED forever and
    // order-service never runs its COMPLETED block — no loyalty points (BR-013), no referral
    // qualification (FR-092) and, worst of all, no stock consume (FR-067..074), so the
    // checkout hold is never settled and sellable stock drifts negative.
    //
    // Both advances are fail-open now that they run after the proof: the handover happened
    // and is recorded, and no order-service outage can un-happen it. A lagging order is
    // recoverable by hand from the proof; a lost proof is not recoverable at all.
    for (const status of ['DELIVERED', 'COMPLETED'] as const) {
      try {
        await this.advanceOrder(delivery.orderId, status, authorization);
      } catch {
        this.logger.error(
          `Order ${delivery.orderId} has proof of delivery but could not be moved to ${status}`,
        );
        break;
      }
    }
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
      onTime: minutes <= this.config.slaMinutes(delivery.depotId),
    });
  }

  /**
   * Marks the delivery failed and closes its order. A FAILED delivery is terminal — use
   * `reschedule` when the order should live on for a second attempt — so leaving the order
   * mid-flight stranded it at ON_DELIVERY forever, still holding its stock reservation.
   * Cancelling releases that hold through order-service's normal cancel path.
   */
  async fail(
    driverId: string,
    id: string,
    reason: string,
    authorization = '',
  ): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.FAILED);
    this.logger.warn(`Delivery ${id} failed by driver ${driverId}: ${reason}`);
    await this.cancelOrderFor(delivery.orderId, authorization);
    return this.deliveries.applyStatus(
      id,
      delivery.status,
      DeliveryStatus.FAILED,
      { failedAt: new Date(), failureReason: reason },
      driverId,
      reason,
    );
  }

  /**
   * Closes the order behind a failed delivery. Fail-open: the courier's record of the
   * failure must never be lost because order-service was unreachable — a stuck order is
   * recoverable by hand, a lost failure report is not.
   */
  private async cancelOrderFor(orderId: string, authorization: string): Promise<void> {
    try {
      await this.advanceOrder(orderId, 'CANCELLED', authorization);
    } catch {
      this.logger.error(`Delivery failed but order ${orderId} could not be cancelled`);
    }
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
    const policy = this.noShowPolicy(delivery.depotId);
    return {
      attempts: state.attempts,
      eligibleAt: noShowEligibleAt(state, policy),
      canMarkNoShow: canMarkNoShow(state, policy, now),
    };
  }

  /**
   * Fails the delivery as a no-show (design 5a), only once the contact-attempt +
   * wait gate is satisfied. Recorded as a FAILED with a no-show reason.
   */
  async markNoShow(
    driverId: string,
    id: string,
    now: Date = new Date(),
    authorization = '',
  ): Promise<DeliveryRecord> {
    const delivery = await this.ownedByDriver(driverId, id);
    this.assertTransition(delivery.status, DeliveryStatus.FAILED);
    const state = await this.deliveries.contactState(id);
    if (!canMarkNoShow(state, this.noShowPolicy(delivery.depotId), now)) {
      throw new NoShowNotEligibleError(
        this.config.noShowMinContactAttempts(delivery.depotId),
        this.config.noShowMinWaitSeconds(delivery.depotId),
      );
    }
    const reason = 'Pelanggan tidak di tempat (no-show).';
    this.logger.warn(`Delivery ${id} failed as no-show by driver ${driverId}`);
    await this.cancelOrderFor(delivery.orderId, authorization);
    return this.deliveries.applyStatus(
      id,
      delivery.status,
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
      delivery.status,
      DeliveryStatus.RESCHEDULED,
      {
        rescheduledFor: input.rescheduledFor,
        rescheduleSlot: input.slot ?? null,
        rescheduleNote: input.note ?? null,
      },
      driverId,
      input.note ?? null,
    );
    // Hand the order back to the dispatch queue. reschedule frees the courier, so leaving
    // the order on the abandoned attempt's status (ON_DELIVERY etc.) pinned it there: the
    // re-assignment could not advance it and the order could never be delivered.
    await this.advanceOrder(delivery.orderId, 'PREPARING', input.authorization ?? '');
    // ponytail: best-effort customer notice, logged for now. The real crm push
    // (customer notification feed) is wired in slice 6 when crm plumbing lands.
    this.logger.log(
      `Delivery ${id} rescheduled to ${input.rescheduledFor.toISOString()} — customer notice pending (slice 6 crm)`,
    );
    return updated;
  }

  private noShowPolicy(depotId: string | null): NoShowPolicy {
    return {
      minAttempts: this.config.noShowMinContactAttempts(depotId),
      minWaitSeconds: this.config.noShowMinWaitSeconds(depotId),
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
    const eta = await this.estimateArrival({ ...delivery, lastLat: lat, lastLng: lng });
    return this.deliveries.updateLocation(id, lat, lng, eta);
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
  /**
   * Delete proof-of-delivery records older than `cutoff`.
   *
   * The window is NOT computed here any more. admin-service owns the retention policy
   * for every dataset and sends the cutoff; deriving it a second time from a depot
   * setting gave the same legal rule two owners that could silently disagree.
   */
  async purgeProofsOlderThan(cutoff: Date): Promise<{ purged: number }> {
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
    // At ON_DELIVERY start, compute the customer-facing ETA once and both persist it
    // locally and push it onto the order payload the customer reads.
    const eta =
      to === DeliveryStatus.ON_DELIVERY ? await this.estimateArrival(delivery) : undefined;
    const orderStatus = orderStatusFor(to);
    if (orderStatus) {
      await this.advanceOrder(
        delivery.orderId,
        orderStatus,
        authorization,
        eta ? { estimatedArrivalAt: eta } : undefined,
      );
    }
    return this.deliveries.applyStatus(
      id,
      delivery.status,
      to,
      eta ? { ...timestamps, estimatedArrivalAt: eta } : timestamps,
      driverId,
      null,
    );
  }

  /**
   * Estimates arrival at ON_DELIVERY start: straight-line distance ÷ an assumed
   * urban speed. Origin = the driver's last GPS ping if we have one, else the
   * depot's coordinates. Returns undefined (no estimate) when the destination has
   * no coordinates or no origin can be resolved — the customer UI falls back
   * gracefully. Best-effort: a depot-lookup failure never blocks the transition.
   */
  private async estimateArrival(delivery: DeliveryRecord): Promise<Date | undefined> {
    if (delivery.destinationLat == null || delivery.destinationLng == null) return undefined;
    let originLat = delivery.lastLat;
    let originLng = delivery.lastLng;
    if (originLat == null || originLng == null) {
      const depot = delivery.depotId
        ? await this.depots.find(delivery.depotId).catch(() => null)
        : null;
      if (!depot) return undefined;
      originLat = depot.lat;
      originLng = depot.lng;
    }
    const meters = haversineMeters(
      originLat,
      originLng,
      delivery.destinationLat,
      delivery.destinationLng,
    );
    const metersPerMinute = (this.config.urbanSpeedKmph(delivery.depotId) * 1000) / 60;
    const minutes = meters / metersPerMinute;
    return new Date(Date.now() + minutes * 60_000);
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
    meta?: OrderAdvanceMeta,
  ): Promise<void> {
    try {
      await this.orders.advanceStatus(orderId, status, authorization, meta);
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
      depotIds: input.depotIds,
      status: input.status,
    });
    return buildPage(items, total, page, limit);
  }
}
