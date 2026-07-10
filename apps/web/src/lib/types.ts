// Mirrors the backend API contracts consumed through the gateway. Kept flat and
// hand-written (no codegen) — the surface the customer app touches is small.

export type OrderStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'DRIVER_ASSIGNED'
  | 'PICKED_UP'
  | 'ON_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentMethod = 'CASH' | 'TRANSFER' | 'QRIS' | 'EWALLET' | 'VA';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type OtpPurpose = 'REGISTRATION' | 'LOGIN';

export interface Customer {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export interface Session {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  customer: Customer;
}

export interface OtpChallenge {
  phoneMasked: string;
  expiresInSeconds: number;
}

export interface Product {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
  basePrice: number;
  imageUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CartLine {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Cart {
  items: CartLine[];
  subtotal: number;
}

export interface DeliveryAddress {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderStatusEvent {
  status: OrderStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface Order extends DeliveryAddress {
  id: string;
  orderNumber: string;
  customerId: string;
  depotId: string | null;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: OrderItem[];
  history: OrderStatusEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  reference: string | null;
  instruction: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------- Release 2: loyalty, vouchers, referrals ---------- */

export type MembershipTier = 'REGULAR' | 'SILVER' | 'GOLD' | 'PLATINUM';
export type PointsTxnType = 'EARN' | 'EXPIRE' | 'ADJUST' | 'REWARD';

export interface LoyaltyAccount {
  customerId: string;
  tier: MembershipTier;
  pointsBalance: number;
  lifetimePoints: number;
  discountRate: number;
}

export interface TierBenefit {
  tier: MembershipTier;
  threshold: number;
  discountRate: number;
}

export interface PointsTransaction {
  id: string;
  type: PointsTxnType;
  points: number;
  orderId: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface VoucherQuote {
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discount: number;
  valid: true;
}

export interface ReferralCode {
  customerId: string;
  code: string;
  createdAt: string;
}

export interface ReferralSummary {
  code: ReferralCode;
  referrals: unknown[];
  referredCount: number;
  qualifiedCount: number;
  pointsEarned: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ---------- Operational dashboard (MVP #6, staff-facing) ---------- */

export interface SalesReport {
  granularity: string;
  from: string | null;
  to: string | null;
  buckets: { period: string; orderCount: number; revenue: number }[];
}

export interface TopCustomers {
  from: string | null;
  to: string | null;
  items: { customerId: string; orderCount: number; revenue: number }[];
}

export interface TopDepots {
  from: string | null;
  to: string | null;
  items: { depotId: string; orderCount: number; revenue: number }[];
}

export interface DeliverySla {
  from: string | null;
  to: string | null;
  thresholdMinutes: number;
  totalDelivered: number;
  onTime: number;
  breached: number;
  slaRate: number;
  avgMinutes: number | null;
  failedCount: number;
}

export interface ExecutiveDashboard {
  from: string | null;
  to: string | null;
  sales: SalesReport | null;
  topCustomers: TopCustomers | null;
  topDepots: TopDepots | null;
  deliverySla: DeliverySla | null;
  sources: { order: 'ok' | 'unavailable'; delivery: 'ok' | 'unavailable' };
}

/* ---------- Depot inventory (staff-facing) ---------- */

// Base-stock singletons (AIR/GALON/TUTUP/SEGEL) + per-product lines (PRODUK).
export type InventoryItemType = 'AIR' | 'GALON' | 'TUTUP' | 'SEGEL' | 'PRODUK';

// Minimal depot view for the inventory selector (browse returns the full record).
export interface Depot {
  id: string;
  code: string;
  name: string;
  city: string;
}

// Mirrors depot-service ItemView: the stock record plus derived available/low-stock.
export interface InventoryItem {
  id: string;
  depotId: string;
  itemType: InventoryItemType;
  productId: string | null;
  label: string;
  unit: string;
  quantity: number;
  reserved: number;
  minimumStock: number;
  sellPrice: number | null;
  /** quantity − reserved. */
  available: number;
  lowStock: boolean;
}
