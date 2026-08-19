import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

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
  PaymentLookupUnavailableError,
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
import { CustomerNotificationPort } from '../ports/customer-notification.port';
import { OrderAdvanceMeta, OrderCoordinationPort } from '../ports/order-coordination.port';
import { CourierPayoutPort } from '../ports/courier-payout.port';
import { DepotLocationPort } from '../ports/depot-location.port';
import { OrderPaymentPort } from '../ports/order-payment.port';
import { haversineMeters } from '../../domain/geo';
import { clampCapturedAt } from '../../domain/offline';
import { ShiftService } from './shift.service';
import { DELIVERY_TOKENS } from '../tokens';
import { StoragePort } from '../ports/storage.port';
import { EventPublisherPort } from '../ports/event-publisher.port';

/**
 * The storage key inside a stored proof URL. Both adapters build the URL as
 * `<public base>[/uploads]/pod/<uuid>.<ext>`, so the key starts at the `pod/` segment.
 */
export function storageKeyFromUrl(url: string): string | null {
  const at = url.indexOf('pod/');
  return at === -1 ? null : url.slice(at);
}

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
  /**
   * Snapshotted so a notification about this delivery can thread into the customer's
   * in-app feed. Absent for a counter sale, and for every binary released before the
   * field existed — the notification then reaches the phone with a null owner.
   */
  customerId?: string;
  driverPhone?: string;
  items?: { name: string; qty: number }[];
  /**
   * @deprecated Ignored. COD is read from payment-service here — see `OrderPaymentPort`.
   * The field survives because binaries already in Play internal testing still send it and
   * `forbidNonWhitelisted` would 400 them.
   */
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
  /** Keyset cursor from the previous page's `nextCursor` (audit Q-16). */
  cursor?: string;
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
    @Inject(DELIVERY_TOKENS.OrderPayment) private readonly payments: OrderPaymentPort,
    // Optional so an environment with storage disabled still boots; the retention sweep
    // then says out loud that the objects were left behind rather than pretending.
    @Optional() @Inject(DELIVERY_TOKENS.Storage) private readonly storage?: StoragePort,
    @Optional()
    @Inject(DELIVERY_TOKENS.EventPublisher)
    private readonly events?: EventPublisherPort,
    // Optional for the same reason the publisher is: a test double that does not care
    // about notifications should not have to provide one. A missing adapter means the
    // customer is not told, and that is said out loud below rather than assumed.
    @Optional()
    @Inject(DELIVERY_TOKENS.CustomerNotification)
    private readonly customerNotifications?: CustomerNotificationPort,
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

    /*
     * Whether the courier collects on delivery is decided HERE, from payment-service, and
     * the caller's `codAmount` is ignored: the console that clicks this button cannot read
     * payments for two of the five roles allowed to click it (see `OrderPaymentPort`), so
     * every cash order they dispatched went out as non-COD.
     *
     * Read BEFORE the order is advanced. If payment-service cannot answer, this throws and
     * nothing has happened yet — advancing first would leave an order at DRIVER_ASSIGNED
     * with no delivery behind it.
     */
    const payment = await this.payments
      .forOrder(input.orderId)
      .catch(() => {
        throw new PaymentLookupUnavailableError();
      });
    const codAmount = payment?.method === 'CASH' ? payment.amount : null;

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
      customerId: input.customerId ?? null,
      items: input.items ?? null,
      codAmount,
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
    // H-30: the event partners subscribe to. Fan-out, signing and retries belong to
    // admin-service; this only reports that the handover happened.
    void this.publishDelivered(completed, capturedAt, proof.recipientName);
    return completed;
  }

  /**
   * Offers `delivery.delivered` to partner webhook subscribers. Fail-open by contract.
   *
   * Takes the handover time and recipient as arguments rather than re-reading them off the
   * record: at the call site both are known and non-null, and defending against a shape
   * that cannot occur there would only add branches nothing can exercise.
   */
  private async publishDelivered(
    delivery: DeliveryRecord,
    deliveredAt: Date,
    recipientName: string,
  ): Promise<void> {
    if (!this.events) return;
    await this.events.publish(
      'delivery.delivered',
      {
        deliveryId: delivery.id,
        orderId: delivery.orderId,
        orderNumber: delivery.orderNumber,
        depotId: delivery.depotId,
        driverId: delivery.driverId,
        deliveredAt: deliveredAt.toISOString(),
        recipientName,
      },
      deliveredAt,
    );
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
    // The person waiting at home is the one this change is about, and for a long time
    // they were the only party not told: the courier picked a new slot, the order went
    // back to the queue, and this line logged "notice pending". crm's internal endpoint
    // has been carrying order, depot, promo, hr and auth notifications for months.
    await this.notifyRescheduled(delivery, input);
    return updated;
  }

  /**
   * Tell the customer their delivery moved. Fail-open at every step, because the
   * reschedule is already committed: no adapter, no phone on the delivery, or a crm
   * error each log why and return.
   *
   * `recipientPhone` is nullable — a walk-in counter sale has no one to call — so the
   * absence is reported as itself rather than sent to crm as an empty string, which crm
   * would 400 and the adapter would swallow.
   *
   * `customerId` is snapshotted at assignment — the column shipped two releases before this
   * line, and its index one — so the notice threads into that customer's in-app feed as well
   * as reaching their phone. A delivery assigned before the column existed, or a counter sale
   * with no account behind it, carries null: crm stores a null owner and the notice is
   * phone-only, which is the honest outcome rather than a guessed one.
   */
  private async notifyRescheduled(
    delivery: { id: string; orderNumber: string; recipientPhone: string | null; customerId?: string | null },
    input: { rescheduledFor: Date; slot?: string | null; note?: string | null },
  ): Promise<void> {
    if (!this.customerNotifications) {
      this.logger.warn(`Delivery ${delivery.id} rescheduled — no notification adapter configured`);
      return;
    }
    if (!delivery.recipientPhone) {
      this.logger.warn(
        `Delivery ${delivery.id} rescheduled — no recipient phone on the delivery, customer not told`,
      );
      return;
    }
    await this.customerNotifications.notify(
      'DELIVERY_RESCHEDULED',
      delivery.recipientPhone,
      {
        orderNumber: delivery.orderNumber,
        rescheduledFor: input.rescheduledFor.toISOString(),
        slot: input.slot ?? '',
        note: input.note ?? '',
      },
      delivery.customerId ?? null,
    );
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
    // A projection, not the whole delivery (audit S-17): a ping arrives every few seconds
    // per courier on the road, and it used to drag the full status history and the delivery
    // proof back with it just to check an id and a status.
    const state = await this.deliveries.findPingState(id);
    if (!state) {
      throw new DeliveryNotFoundError();
    }
    if (state.driverId !== driverId) {
      throw new NotAssignedDriverError();
    }
    if (!isActive(state.status)) {
      throw new DeliveryNotActiveError();
    }
    const eta = await this.estimateArrival({ ...state, lastLat: lat, lastLng: lng });
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
   * Delete proof-of-delivery records older than `cutoff`, and the photos with them.
   *
   * The window is NOT computed here any more. admin-service owns the retention policy
   * for every dataset and sends the cutoff; deriving it a second time from a depot
   * setting gave the same legal rule two owners that could silently disagree.
   *
   * H-22: the row alone was never erasure. The photo is of someone's doorstep, often with
   * them in frame, and it outlived the record by however long the bucket kept it.
   */
  async purgeProofsOlderThan(cutoff: Date): Promise<{ purged: number }> {
    const { count: purged, urls } = await this.deliveries.purgeProofsBefore(cutoff);
    for (const url of urls) {
      const key = storageKeyFromUrl(url);
      if (!key) {
        this.logger.warn(`Retention: cannot derive a storage key from ${url}; object left behind`);
        continue;
      }
      if (!this.storage) {
        this.logger.warn(`Retention: no storage bound; ${key} not deleted`);
        continue;
      }
      try {
        await this.storage.remove(key);
      } catch (err) {
        // The row is already gone; a bucket that refuses one delete must not abort the
        // sweep for every other customer. Logged so the leftover object is findable.
        this.logger.error(
          `Retention: deleted the proof row but not ${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (purged > 0) {
      this.logger.log(
        `Purged ${purged} proof-of-delivery record(s) and ${urls.length} object(s) older than ${cutoff.toISOString()}`,
      );
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
  private async estimateArrival(
    delivery: Pick<
      DeliveryRecord,
      'destinationLat' | 'destinationLng' | 'lastLat' | 'lastLng' | 'depotId'
    >,
  ): Promise<Date | undefined> {
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

  /**
   * B2: staff take a delivery back off a courier who cannot finish it.
   *
   * Every escape hatch the domain already allows — ASSIGNED / PICKED_UP / ON_DELIVERY to
   * FAILED or RESCHEDULED — was keyed to `ownedByDriver`, so ONLY the courier holding the
   * delivery could take it. A courier whose phone dies takes the order with them: it
   * freezes mid-flight, and the stock reserved at checkout stays held behind it. Dispatch
   * could not route around it either, because `assign` refuses while a live delivery row
   * exists and only the courier could move it to RESCHEDULED.
   *
   * Two actions, because the two situations are different money:
   *
   * - `releaseByStaff` frees the courier and hands the ORDER back to the dispatch queue.
   *   The customer is still getting their water; somebody else takes it. Same move the
   *   courier's own reschedule makes, and `assign` re-opens the RESCHEDULED row.
   * - `cancelByStaff` ends it. The order is cancelled, which is what gives the checkout
   *   hold back — a frozen order holds stock nobody can sell.
   *
   * Authorised by depot rather than by ownership: this is the depot's dispatcher acting on
   * their own depot's work, which is exactly the thing the courier cannot do.
   */
  async releaseByStaff(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    authorization = '',
  ): Promise<DeliveryRecord> {
    const delivery = await this.staffOwned(user, id);
    this.assertTransition(delivery.status, DeliveryStatus.RESCHEDULED);
    this.logger.warn(`Delivery ${id} released by staff ${user.sub}: ${reason}`);
    const updated = await this.deliveries.applyStatus(
      id,
      delivery.status,
      DeliveryStatus.RESCHEDULED,
      { rescheduleNote: reason },
      user.sub,
      reason,
    );
    // Back to the dispatch queue. Leaving the order on the abandoned attempt's status
    // (PICKED_UP, ON_DELIVERY) pins it there: the re-assignment cannot advance it and the
    // order can never be delivered — the same trap the courier's reschedule fixed.
    await this.advanceOrder(delivery.orderId, 'PREPARING', authorization);
    return updated;
  }

  async cancelByStaff(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    authorization = '',
  ): Promise<DeliveryRecord> {
    const delivery = await this.staffOwned(user, id);
    this.assertTransition(delivery.status, DeliveryStatus.FAILED);
    this.logger.warn(`Delivery ${id} cancelled by staff ${user.sub}: ${reason}`);
    // Fail-open on order-service exactly like the courier's own failure report: the record
    // that this delivery is over must not be lost because another service blinked.
    await this.cancelOrderFor(delivery.orderId, authorization);
    return this.deliveries.applyStatus(
      id,
      delivery.status,
      DeliveryStatus.FAILED,
      { failedAt: new Date(), failureReason: reason },
      user.sub,
      reason,
    );
  }

  /** A delivery this staff member's depot owns. The staff counterpart of `ownedByDriver`. */
  private async staffOwned(user: AuthenticatedUser, id: string): Promise<DeliveryRecord> {
    const delivery = await this.getAny(id);
    assertDepotAccess(user, delivery.depotId);
    return delivery;
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
    const { items, total, nextCursor } = await this.deliveries.search({
      page,
      limit,
      cursor: input.cursor,
      driverId: input.driverId,
      depotIds: input.depotIds,
      status: input.status,
    });
    return buildPage(items, total, page, limit, nextCursor);
  }
}
