import { OrderStatus } from '../../domain/order-status';

export interface OrderItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderStatusHistoryRecord {
  status: OrderStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: Date;
}

export interface DeliveryAddressSnapshot {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface OrderRecord extends DeliveryAddressSnapshot {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: OrderItemRecord[];
  history: OrderStatusHistoryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderItemData {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface CreateOrderData extends DeliveryAddressSnapshot {
  orderNumber: string;
  customerId: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: CreateOrderItemData[];
}

export interface OrderQuery {
  customerId?: string;
  status?: OrderStatus;
  page: number;
  limit: number;
}

export interface OrderRepository {
  create(data: CreateOrderData): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  search(query: OrderQuery): Promise<{ items: OrderRecord[]; total: number }>;
  /** Atomically move the order to `status` and append a history row. */
  applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
  ): Promise<OrderRecord>;
}
