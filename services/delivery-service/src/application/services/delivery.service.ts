import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DeliveryAlreadyExistsError,
  DeliveryNotFoundError,
  DriverBusyError,
  InvalidDeliveryTransitionError,
  NotAssignedDriverError,
  OrderCoordinationError,
} from '../../domain/errors';
import {
  DeliveryStatus,
  OrderFulfilmentStatus,
  canTransition,
  orderStatusFor,
} from '../../domain/delivery-status';
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
import { DELIVERY_TOKENS } from '../tokens';

export interface AssignInput {
  orderId: string;
  orderNumber: string;
  driverId: string;
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

@Injectable()
export class DeliveryService {
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.OrderCoordination) private readonly orders: OrderCoordinationPort,
    private readonly config: DeliveryConfigService,
  ) {}

  /**
   * Assigns a driver to an order (staff). Enforces one delivery per order and
   * the per-driver active-delivery cap (BR: one driver = one active order). The
   * order is advanced to DRIVER_ASSIGNED on order-service first (which validates
   * BR-012); the delivery is then recorded.
   */
  async assign(
    actorId: string,
    input: AssignInput,
    authorization: string,
  ): Promise<DeliveryRecord> {
    if (await this.deliveries.findByOrder(input.orderId)) {
      throw new DeliveryAlreadyExistsError();
    }
    const active = await this.deliveries.countActiveByDriver(input.driverId);
    if (active >= this.config.maxActiveDeliveriesPerDriver) {
      throw new DriverBusyError();
    }

    await this.advanceOrder(input.orderId, 'DRIVER_ASSIGNED', authorization);

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
    return completed;
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
  ): Promise<void> {
    try {
      await this.orders.advanceStatus(orderId, status, authorization);
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
