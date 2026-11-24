import { OrderFulfilmentStatus } from '../../domain/delivery-status';

/** Extra snapshot fields pushed onto the order alongside a status transition. */
export interface OrderAdvanceMeta {
  /** Courier display name, snapshotted at DRIVER_ASSIGNED. */
  driverName?: string;
  /** Courier phone, snapshotted at DRIVER_ASSIGNED so the customer can call. */
  driverPhone?: string;
  /** Customer-facing ETA, set at ON_DELIVERY. */
  estimatedArrivalAt?: Date;
}

/**
 * Advances the order on the order-service as the delivery progresses. The
 * caller's access token is forwarded so order-service enforces its own RBAC
 * (BR-012) — order-service stays the single source of truth for order status.
 */
export interface OrderCoordinationPort {
  advanceStatus(
    orderId: string,
    status: OrderFulfilmentStatus,
    authorization: string,
    meta?: OrderAdvanceMeta,
  ): Promise<void>;
}
