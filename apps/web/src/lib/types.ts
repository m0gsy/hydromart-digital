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
  avatarUrl: string | null;
  assignedDepotId?: string | null;
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

/** A ranked product suggestion (reorder / related / trending rails). */
export interface Recommendation {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  score: number;
}

/** A catalog category (public /products/categories). */
export interface Category {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
}

/** A marketing banner shown on the customer Home (public /vouchers/promotions). */
export interface Promotion {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  voucherCode: string | null;
  sortOrder: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface PromotionPayload {
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  voucherCode?: string | null;
  sortOrder?: number;
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** A depot annotated with distance from the user's location (public /depots/nearby). */
export interface NearbyDepot {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  deliveryFee: number;
  minOrderAmount: number | null;
  /** Great-circle km from the queried point, nearest first. */
  distanceKm: number;
  /** True when distanceKm <= serviceRadiusKm (depot delivers to the point). */
  withinService: boolean;
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

/** A saved delivery address from the customer's address book. */
export interface Address {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
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
  reviewed: boolean;
  driverName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

// Recurring galon subscription (spec 7b).
export interface Subscription {
  id: string;
  customerId: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  frequency: SubscriptionFrequency;
  status: SubscriptionStatus;
  nextDeliveryAt: string;
  createdAt: string;
  updatedAt: string;
}

// Customer's rating of an order (spec 7c).
export interface OrderReview {
  id: string;
  orderId: string;
  customerId: string;
  rating: number;
  aspects: string[];
  comment: string | null;
  tipAmount: number;
  createdAt: string;
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
  // COD only (design 7a): cash tendered + change given back, set on confirm.
  cashReceived?: number | null;
  changeGiven?: number | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------- Release 2: loyalty, vouchers, referrals ---------- */

export type MembershipTier = 'REGULAR' | 'SILVER' | 'GOLD' | 'PLATINUM';
export type PointsTxnType = 'EARN' | 'EXPIRE' | 'ADJUST' | 'REWARD' | 'REDEEM';

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

/** A redeemable reward in the points catalog (loyalty /rewards/catalog). */
export interface RewardItem {
  id: string;
  name: string;
  unit: string;
  pointsCost: number;
  imageUrl: string | null;
  /** Remaining stock; null = unlimited. */
  stock: number | null;
}

/** Result of redeeming points for a reward (loyalty /rewards/redeem). */
export interface RewardRedemption {
  redemptionId: string;
  rewardItemId: string;
  pointsSpent: number;
  /** Spendable balance after the debit. */
  pointsBalance: number;
}

export type DiscountType = 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';

/** An admin voucher record (vouchers GET /vouchers; admin list includes inactive). */
export interface Voucher {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  usedCount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Create/patch payload for a voucher (vouchers POST/PATCH). `code` is create-only. */
export interface VoucherPayload {
  code?: string;
  description?: string | null;
  discountType?: DiscountType;
  value?: number;
  minSpend?: number;
  maxDiscount?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number;
  budgetCap?: number | null;
  active?: boolean;
}

export type VoucherStatus = 'AVAILABLE' | 'USED' | 'EXPIRED' | 'UPCOMING' | 'SOLD_OUT';

/** A voucher in the customer's wallet (vouchers /vouchers/me). */
export interface MyVoucher {
  code: string;
  description: string | null;
  discountType: 'PERCENTAGE' | 'FIXED';
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validUntil: string | null;
  status: VoucherStatus;
}

export type SavedPaymentType = 'CASH' | 'TRANSFER' | 'QRIS' | 'EWALLET' | 'VA';

/** A saved payment instrument (customers /payment-methods). */
export interface SavedPaymentMethod {
  id: string;
  type: SavedPaymentType;
  label: string;
  maskedIdentifier: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPaymentMethodPayload {
  type: SavedPaymentType;
  label: string;
  maskedIdentifier?: string;
  isDefault?: boolean;
}

/** Notification channel preferences (customers /profile/notifications). */
export interface NotificationPreferences {
  customerId: string;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
}

export type NotificationEvent =
  | 'ORDER_RECEIVED'
  | 'ORDER_CONFIRMED'
  | 'ORDER_ON_DELIVERY'
  | 'ORDER_DELIVERED'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'CUSTOMER_REGISTERED'
  | 'STOCK_LOW'
  | 'POINTS_EARNED'
  | 'VOUCHER_GRANTED'
  | 'REORDER_REMINDER';

// A row from the customer's notification feed (crm-service audit trail).
export interface Notification {
  id: string;
  event: NotificationEvent;
  customerId: string | null;
  phone: string;
  message: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
}

export interface ProfileUpdatePayload {
  fullName?: string;
  email?: string;
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

/* ---------- CRM broadcast campaigns (staff-facing) ---------- */

export type CampaignStatus = 'DRAFT' | 'SENDING' | 'SENT';

// Recipient as sent to POST /campaigns; name feeds the {{name}} template token.
export interface RecipientInput {
  phone: string;
  name?: string;
  customerId?: string;
}

// Attribute segment (FR-087): tier and/or primary-address city. Resolved to
// recipients server-side from customer-service.
export interface CampaignSegment {
  tier?: string;
  city?: string;
}

export type RecipientStatus = 'PENDING' | 'SENT' | 'FAILED';

// One recipient's delivery outcome (crm campaign detail GET).
export interface CampaignRecipient {
  id: string;
  customerId: string | null;
  phone: string;
  name: string | null;
  status: RecipientStatus;
  error: string | null;
  sentAt: string | null;
}

// Full campaign incl. message body + per-recipient report (detail GET).
export interface CampaignDetail extends Campaign {
  messageTemplate: string;
  updatedAt: string;
  recipients: CampaignRecipient[];
}

// List-item shape (no message body / recipients — those come from the detail GET).
export interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
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

// 22b — revenue share per product (order-service has no category column, so grouping
// is always 'product'; the web labels it "per produk" honestly).
export interface RevenueByProduct {
  grouping: 'product';
  from: string | null;
  to: string | null;
  items: { productId: string; productName: string; orderCount: number; revenue: number; share: number }[];
}

// 22b — retention grid: rows = first-order-month cohorts, cells = retention ratio (0..1).
export interface RetentionCohort {
  from: string | null;
  to: string | null;
  rows: { label: string; cohortSize: number; cells: number[] }[];
}

// 17e — one customer's lifetime aggregate + recent orders (Customer 360).
export interface CustomerSummary {
  customerId: string;
  orderCount: number;
  revenue: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  recentOrders: { id: string; orderNumber: string; status: string; total: number; createdAt: string }[];
}

// 18c — HQ network subscription aggregate. estMonthlyDeliveries is an estimate (no
// rupiah MRR is derivable — subscriptions snapshot no price).
export interface SubscriptionNetworkSummary {
  activeSubscriptions: number;
  activeSubscribers: number;
  estMonthlyDeliveries: number;
  plans: { productName: string; frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; subscribers: number }[];
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

export interface FranchiseDepotSummary {
  depotId: string;
  code: string;
  name: string;
  active: boolean;
  orderCount: number;
  revenue: number;
  lowStockCount: number;
}

// HQ network roll-up (dashboard-service GET /dashboard/network): one row per depot
// with real revenue/orders (order-service), on-time SLA (delivery-service), and
// low-stock count (depot-service). slaRate is null when a depot has no delivered
// orders in range.
export interface NetworkDepotRow {
  depotId: string;
  code: string;
  name: string;
  active: boolean;
  ownershipType: string;
  revenue: number;
  orderCount: number;
  slaRate: number | null;
  avgMinutes: number | null;
  rating: number | null;
  lowStockCount: number;
}

// Current user's active device session (auth-service GET /sessions). No geo lookup, so
// no location; userAgent is the raw device string.
export interface AdminSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

// Network gallon rollup (depot-service GET /gallon-outstanding): per-depot empties still
// at customers (issued − returned) + deposit still held (held − refunded).
export interface GallonOutstanding {
  depotId: string;
  issued: number;
  returned: number;
  outstanding: number;
  depositHeld: number;
  depositRefunded: number;
  netDeposit: number;
}

export interface NetworkDashboard {
  from: string | null;
  to: string | null;
  depots: NetworkDepotRow[];
  sources: {
    depot: 'ok' | 'unavailable';
    order: 'ok' | 'unavailable';
    delivery: 'ok' | 'unavailable';
    inventory: 'ok' | 'unavailable';
  };
}

export interface FranchiseDashboard {
  from: string | null;
  to: string | null;
  depots: FranchiseDepotSummary[];
  totals: { depotCount: number; revenue: number; orderCount: number; lowStockCount: number };
  deliverySla: DeliverySla | null;
  sources: {
    depot: 'ok' | 'unavailable';
    order: 'ok' | 'unavailable';
    delivery: 'ok' | 'unavailable';
    inventory: 'ok' | 'unavailable';
  };
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

// ---- Payout / komisi (payout-service, "Keuangan · usulan") ----
export type LedgerEntryType =
  | 'SALE_SETTLEMENT'
  | 'COMMISSION'
  | 'STOCK_PURCHASE'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT';
export type WithdrawalStatus = 'PROCESSING' | 'PAID' | 'FAILED';

export interface LedgerEntry {
  id: string;
  franchiseOwnerId: string;
  depotId: string | null;
  type: LedgerEntryType;
  amount: number;
  description: string;
  occurredAt: string;
  createdAt: string;
}

export interface Withdrawal {
  id: string;
  franchiseOwnerId: string;
  amount: number;
  bankAccountRef: string;
  status: WithdrawalStatus;
  reference: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutSummary {
  availableBalance: number;
  monthRevenue: number;
  monthCommission: number;
  nextPayoutDate: string;
  recentEntries: LedgerEntry[];
  recentWithdrawals: Withdrawal[];
}

// HQ franchise-application approvals (depot-service, design 5a/5b).
export type FranchiseAppStage = 'PENDING' | 'DOC_VERIFICATION' | 'SURVEY' | 'APPROVED' | 'REJECTED';
export type ChecklistItemStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ChecklistItem = 'ktpNpwp' | 'locationProof' | 'capitalDeposit' | 'fieldSurvey';
export type ApplicationChecklist = Record<ChecklistItem, ChecklistItemStatus>;

export interface FranchiseApplication {
  id: string;
  applicantName: string;
  applicantPhone: string;
  proposedCode: string;
  proposedName: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  investmentAmount: number;
  projectedMonthlyRevenue: number;
  checklist: ApplicationChecklist;
  stage: FranchiseAppStage;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

// Onboard-form prefill returned by POST /franchise-applications/:id/approve.
export interface ProposedDepot {
  code: string;
  name: string;
  ownershipType: 'WARALABA';
  city: string;
  province: string;
  lat: number;
  lng: number;
}
export interface ApproveApplicationResult {
  application: FranchiseApplication;
  proposedDepot: ProposedDepot;
}

// HQ commission scheme per depot (payout-service, design 21c).
export interface CommissionScheme {
  id: string;
  depotId: string;
  ownerName: string | null;
  pct: number;
  effectiveDate: string;
  createdAt: string;
}

// Per-depot payment destination (franchise: money goes direct to each depot).
// Static QRIS + bank account shown to the customer at pay time; confirmed by staff.
export interface DepotPaymentInfo {
  paymentBankName: string | null;
  paymentBankAccountNumber: string | null;
  paymentBankAccountHolder: string | null;
  paymentQrisImageUrl: string | null;
}

// Full admin record (from GET /depots/manage) + the create/update payload shape.
export interface DepotAdmin extends Depot, DepotPaymentInfo {
  ownershipType: string;
  address: string;
  province: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  deliveryFee: number;
  minOrderAmount: number | null;
  active: boolean;
  // Franchise owner account id (null for company-owned depots) — drives the payout card.
  ownerId?: string | null;
  operatingHours?: Record<string, DepotHours>;
  holidays?: DepotHoliday[];
}

// One franchise owner's payout standing (payout-service GET payout/hq/owner/:ownerId).
export interface OwnerPayoutBalance {
  franchiseOwnerId: string;
  availableBalance: number;
  nextPayoutDate: string;
}

export interface DepotHours {
  open: string;
  close: string;
}
export interface DepotHoliday {
  date: string;
  label?: string;
}

export interface DepotPayload {
  code: string;
  name: string;
  ownershipType: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  deliveryFee: number;
  minOrderAmount: number | null;
  serviceRadiusKm?: number;
  paymentBankName?: string | null;
  paymentBankAccountNumber?: string | null;
  paymentBankAccountHolder?: string | null;
  paymentQrisImageUrl?: string | null;
}

// Delivery (delivery-service). Live-tracking slice consumed by the ops console.
export type DeliveryStatus =
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'ON_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RESCHEDULED';

export interface DeliveryStatusHistoryEntry {
  status: DeliveryStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface ProofOfDelivery {
  photoUrl: string;
  signatureUrl: string;
  recipientName: string;
  latitude: number;
  longitude: number;
  note: string | null;
  capturedAt: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  orderNumber: string;
  driverId: string;
  depotId: string | null;
  status: DeliveryStatus;
  destinationAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: string | null;
  assignedAt: string;
  // Present on the driver detail read (getForDriver); absent from the tracking list.
  pickedUpAt?: string | null;
  startedAt?: string | null;
  deliveredAt?: string | null;
  failedAt?: string | null;
  failureReason?: string | null;
  rescheduledFor?: string | null;
  rescheduleSlot?: string | null;
  rescheduleNote?: string | null;
  proof?: ProofOfDelivery | null;
  history?: DeliveryStatusHistoryEntry[];
}

/** No-show gate status returned by the contact-attempt endpoint (design 5a). */
export interface NoShowStatus {
  attempts: number;
  eligibleAt: string | null;
  canMarkNoShow: boolean;
}

// Courier shift (delivery-service). Front door of the driver app (design 3a/3b).
export type ShiftStatus = 'ONLINE' | 'BREAK' | 'OFFLINE' | 'ENDED';

export interface Shift {
  id: string;
  driverId: string;
  depotId: string;
  status: ShiftStatus;
  checkInAt: string;
  checkInLat: number;
  checkInLng: number;
  expectedEndAt: string;
  checkOutAt: string | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  breakSecondsUsed: number;
  breakStartedAt: string | null;
  // Derived by the service, shown but never stored.
  breakSecondsRemaining: number;
  acceptsAssignments: boolean;
}

// Courier field incident (delivery-service, design 4b). HIGH alerts ops.
// Named Courier* to avoid the HQ admin IncidentSeverity below.
export type CourierIncidentCategory =
  | 'ACCIDENT'
  | 'VEHICLE_BREAKDOWN'
  | 'THEFT_OR_THREAT'
  | 'CUSTOMER_DISPUTE'
  | 'PRODUCT_DAMAGE'
  | 'OTHER';

export type CourierIncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FieldIncident {
  id: string;
  deliveryId: string | null;
  category: CourierIncidentCategory;
  severity: CourierIncidentSeverity;
  description: string;
  photoUrl: string | null;
  createdAt: string;
}

// Ops notification (crm-service). Operational alert feed for staff.
export interface OpsNotification {
  id: string;
  event: string;
  customerId: string | null;
  phone: string;
  message: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
}

// Retur galon (depot-service GallonReturn). Empties handed back + deposit refunded.
export type GallonCondition = 'GOOD' | 'DAMAGED';

export interface GallonReturn {
  id: string;
  depotId: string;
  customerId: string | null;
  quantity: number;
  condition: GallonCondition;
  depositRefunded: number;
  note: string | null;
  actorId: string;
  createdAt: string;
}

export interface GallonReturnSummary {
  returns: number;
  gallons: number;
  damaged: number;
  depositRefunded: number;
}

// Empty gallon issued to a customer on deposit (depot-service GallonIssue, 11c).
export interface GallonIssue {
  id: string;
  depotId: string;
  customerId: string | null;
  quantity: number;
  depositHeld: number;
  note: string | null;
  actorId: string;
  createdAt: string;
}

export interface GallonIssueSummary {
  issues: number;
  gallons: number;
  depositHeld: number;
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

// One row in a stock line's append-only movement ledger (10b).
export type StockMovementType = 'RECEIPT' | 'ADJUSTMENT' | 'OPNAME' | 'SALE';

export interface StockMovement {
  id: string;
  itemId: string;
  type: StockMovementType;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  actorId: string;
  orderId: string | null;
  createdAt: string;
}

// Per-depot resolved price for one product (depot-service resolvePrices, 11a).
// Both fields optional: override-only, rule-only, or both. Neither = catalog base.
export interface ResolvedPrice {
  productId: string;
  sellPrice?: number;
  adjustType?: PricingAdjustType;
  value?: number;
}

/* ---------- Demand forecast (staff-facing planning) ---------- */

// Lean per-product row in a depot rollup (mirrors forecast-service ForecastItem).
export interface ForecastItem {
  productId: string;
  name: string | null;
  sku: string | null;
  unit: string | null;
  avgDaily: number;
  trendSlope: number;
  predictedTotal: number;
  reorderSuggestion: number;
}

// Single-product forecast + its history window (mirrors forecast-service ForecastResult).
export interface ForecastResult extends ForecastItem {
  predictedDaily: number[];
  confidence: number; // 0..1 trust in the projection (history density/stability/length)
  history: number[];
}

// Depot (or global) revenue forecast in rupiah (mirrors forecast-service sales response).
export interface SalesForecast {
  depotId: string | null;
  avgDaily: number;
  trendSlope: number;
  predictedDaily: number[];
  predictedTotal: number;
  history: number[];
}

export type ChurnRiskBand = 'LOW' | 'MEDIUM' | 'HIGH';

// One at-risk customer row (mirrors forecast-service churn response item).
export interface ChurnCustomer {
  customerId: string;
  lastOrderAt: string;
  orderCount: number;
  daysSince: number;
  riskScore: number;
  riskBand: ChurnRiskBand;
}

/* ---------- Dynamic pricing (staff-facing) ---------- */

export type PricingAdjustType = 'PERCENT' | 'FIXED';

export interface PricingRule {
  id: string;
  depotId: string;
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: string | null;
  validUntil: string | null;
  priority: number;
  active: boolean;
}

export interface PricingRulePayload {
  productId?: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: string | null;
  validUntil: string | null;
  priority: number;
  active: boolean;
}

// HQ Backend Phase 3 — audit trail (8a), tax settings (19f/24d), refund queue (14a).
export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  target: string | null;
  success: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TaxSettings {
  ppnPercent: number;
  priceIncludesTax: boolean;
  invoiceFormat: string;
  companyName: string;
  npwp: string;
  address: string;
  updatedAt: string | null;
}

export type RefundApproval = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

// A payment awaiting HQ refund approval. Depot & order number are not owned by
// payment-service, so the queue exposes orderId/customerId only (residual gap).
export interface RefundQueueItem {
  id: string;
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  refundReason: string | null;
  refundApproval: RefundApproval;
  createdAt: string;
  updatedAt: string;
}

// HQ settlement dashboard (6a): one payment-method's unsettled (PENDING) total + count,
// network-wide. Method is the raw enum; the console maps it to a display label.
export interface UnsettledMethodBucket {
  method: PaymentMethod;
  amount: number;
  count: number;
}

// HQ payout-release queue (6a): an owner with a positive network balance awaiting
// release. payout-service does not own owner/depot names, so only the owner id is
// exposed (residual gap — the console shortens it for display).
export interface PendingPayout {
  franchiseOwnerId: string;
  availableBalance: number;
  nextPayoutDate: string;
}

// HQ price-override approval queue (7a). depotName/productName/currentPrice are
// denormalized snapshots captured at propose time so the queue renders fully.
export type PriceAdjustType = 'PERCENT' | 'FIXED';
export interface PriceOverrideProposalItem {
  id: string;
  depotId: string;
  depotName: string;
  productId: string;
  productName: string;
  currentPrice: number;
  adjustType: PriceAdjustType;
  value: number;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  proposedBy: string;
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// Depot→HQ voucher request (promo-service voucher-requests, design 14b).
export interface VoucherRequestItem {
  id: string;
  depotId: string;
  depotName: string;
  code: string;
  description: string | null;
  discountType: 'PERCENTAGE' | 'FIXED';
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  decidedBy: string | null;
  createdVoucherId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Platform administration (admin-service). Feature flags (8b), system settings (8b),
// and the aggregate per-service health roll-up (13b).
export type FlagState = 'ROLLOUT' | 'ACTIVE' | 'BETA' | 'OFF';
export interface FeatureFlag {
  id: string;
  key: string;
  label: string;
  description: string;
  state: FlagState;
  rolloutPct: number | null;
  updatedAt: string;
}
export interface SystemSettings {
  defaultTimezone: string;
  currency: string;
  serviceRadiusKm: number;
  updatedAt: string;
}

// admin-service integration & governance (13d / 19c / 13c / 15c).
export type ApiKeyEnvironment = 'PROD' | 'STAGING';
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  environment: ApiKeyEnvironment;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
/** Create/rotate response — carries the full secret exactly once. */
export interface CreatedApiKey extends ApiKey {
  token: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastDeliveryStatus: string | null;
  deliveryRatePct: number | null;
  createdAt: string;
}

export type ExportFormat = 'XLSX' | 'CSV' | 'PDF';
export type ExportStatus = 'PENDING' | 'DONE' | 'FAILED';
export interface ExportLogEntry {
  id: string;
  dataset: string;
  requestedById: string | null;
  requestedByEmail: string;
  format: ExportFormat;
  rowCount: number | null;
  status: ExportStatus;
  createdAt: string;
}

export type ReportCadence = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export interface ScheduledReport {
  id: string;
  name: string;
  cadence: ReportCadence;
  recipients: string[];
  format: ExportFormat;
  nextRunAt: string | null;
  enabled: boolean;
  createdAt: string;
}
export interface ServiceHealth {
  name: string;
  status: 'up' | 'down';
  latencyMs: number;
  httpStatus: number | null;
}

// Support tickets (15a) — admin-service.
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'RESOLVED';
export type TicketAuthorType = 'CUSTOMER' | 'STAFF';
export interface TicketMessage {
  id: string;
  authorType: TicketAuthorType;
  body: string;
  createdAt: string;
}
export interface SupportTicket {
  id: string;
  subject: string;
  customerRef: string;
  customerPhone: string;
  orderRef: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  createdAt: string;
  messages: TicketMessage[];
}

// Fraud & risk flags (15b) — admin-service.
export type FraudEntityType = 'ORDER' | 'ACCOUNT';
export type FraudLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type FraudStatus = 'OPEN' | 'REVIEWED' | 'BLOCKED' | 'CLEARED';
export interface FraudFlag {
  id: string;
  entityType: FraudEntityType;
  entityRef: string;
  score: number;
  level: FraudLevel;
  signals: string[];
  status: FraudStatus;
  createdAt: string;
}

// Incident timeline (14c) — admin-service.
export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type IncidentStatus = 'ONGOING' | 'RESOLVED';
export interface IncidentUpdate {
  id: string;
  note: string;
  createdAt: string;
}
export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  affectedService: string;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  note: string | null;
  updates: IncidentUpdate[];
}
export interface SystemHealth {
  services: ServiceHealth[];
  upCount: number;
  total: number;
  checkedAt: string;
}

// Governance & config (0004_admin_config) — admin-service.
// SLA policy (19d).
export interface SlaPolicy {
  onTimeThresholdMinutes: number;
  healthyBandPct: number;
  criticalBandPct: number;
  updatedAt: string;
}

// Retention & backup (19e).
export interface RetentionPolicy {
  id: string;
  dataset: string;
  windowLabel: string;
  windowDays: number;
  updatedAt: string;
}
/** Read-only. status "NONE" = no backup engine is wired/has run. */
export interface BackupStatus {
  status: string;
  lastBackupAt: string | null;
}
export interface RetentionOverview {
  policies: RetentionPolicy[];
  backup: BackupStatus;
}

// Security policy (19b). Active sessions are NOT here — they live in auth-service.
export interface SecurityPolicy {
  idleTimeoutMinutes: number;
  require2fa: boolean;
  ipAllowlist: string[];
  updatedAt: string;
}

// Per-admin notification prefs (23a). Event ids are canonical; labels are i18n on the web.
export type NotificationEventId =
  | 'criticalSla'
  | 'newFranchiseApp'
  | 'payoutPending'
  | 'systemIncident'
  | 'dailyDigest';
export interface NotificationChannelPref {
  id: NotificationEventId;
  push: boolean;
  email: boolean;
  wa: boolean;
}
export interface AdminNotificationPrefs {
  events: NotificationChannelPref[];
  updatedAt: string;
}

// First-run onboarding wizard state (23b).
export type OnboardingStep =
  | 'verify2fa'
  | 'addDepot'
  | 'inviteHeadOffice'
  | 'setPricingTax'
  | 'enablePayments';
export interface OnboardingState {
  verify2fa: boolean;
  addDepot: boolean;
  inviteHeadOffice: boolean;
  setPricingTax: boolean;
  enablePayments: boolean;
  updatedAt: string;
}
