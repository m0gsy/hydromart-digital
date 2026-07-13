import { OrderFulfilmentStatus } from '../../domain/delivery-status';

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
    driverName?: string,
  ): Promise<void>;
}
