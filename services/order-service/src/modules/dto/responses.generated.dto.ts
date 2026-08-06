// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `SalesBucket` exactly — generated for audit D-6, no field added or removed. */
export class SalesBucketResponseDto {
  @ApiProperty({ type: String })
  period!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
}

/** Mirrors `SalesReport` exactly — generated for audit D-6, no field added or removed. */
export class SalesReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ enum: ['daily', 'monthly'] })
  granularity!: string;
  @ApiProperty({ type: [SalesBucketResponseDto] })
  buckets!: SalesBucketResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class DepotRatingsReportRecentResponseDto {
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ type: Number })
  stars!: number;
  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;
  @ApiProperty({ type: String })
  createdAt!: string;
}

/** Mirrors `DepotRatingsReport` exactly — generated for audit D-6, no field added or removed. */
export class DepotRatingsReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number, nullable: true })
  average!: number | null;
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: Object })
  distribution!: unknown;
  @ApiProperty({ type: [DepotRatingsReportRecentResponseDto] })
  recent!: DepotRatingsReportRecentResponseDto[];
}

/** Mirrors `RevenueByProductReport` exactly — generated for audit D-6, no field added or removed. */
export class RevenueByProductReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ enum: ['product'] })
  grouping!: string;
  @ApiProperty({ type: [Object] })
  items!: unknown[];
}

/** Mirrors `RetentionCohortRow` exactly — generated for audit D-6, no field added or removed. */
export class RetentionCohortRowResponseDto {
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  cohortSize!: number;
  @ApiProperty({ type: [Number] })
  cells!: number[];
}

/** Mirrors `RetentionCohortReport` exactly — generated for audit D-6, no field added or removed. */
export class RetentionCohortReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [RetentionCohortRowResponseDto] })
  rows!: RetentionCohortRowResponseDto[];
}

/** Mirrors `DepotCourierDaily` exactly — generated for audit D-6, no field added or removed. */
export class DepotCourierDailyResponseDto {
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Number })
  completed!: number;
  @ApiProperty({ type: Number })
  failed!: number;
  @ApiProperty({ type: Number })
  codIdr!: number;
}

/** Mirrors `DepotDailyReport` exactly — generated for audit D-6, no field added or removed. */
export class DepotDailyReportResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  date!: string;
  @ApiProperty({ type: Number })
  orders!: number;
  @ApiProperty({ type: Number })
  revenueIdr!: number;
  @ApiProperty({ type: Number })
  gallonsDelivered!: number;
  @ApiProperty({ type: Number, nullable: true })
  gallonsReturned!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  gallonsDamaged!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  codCollectedIdr!: number | null;
  @ApiProperty({ type: Number })
  failedDeliveries!: number;
  @ApiProperty({ type: [DepotCourierDailyResponseDto] })
  perCourier!: DepotCourierDailyResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class DepotWeeklyReportRevenueByDayResponseDto {
  @ApiProperty({ type: String })
  day!: string;
  @ApiProperty({ type: Number })
  revenueIdr!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class DepotWeeklyReportTopProductsResponseDto {
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  qty!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class DepotWeeklyReportTopCourierResponseDto {
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Number })
  delivered!: number;
  @ApiProperty({ required: false, type: Number })
  rating?: number;
}

/** Mirrors `DepotWeeklyReport` exactly — generated for audit D-6, no field added or removed. */
export class DepotWeeklyReportResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  from!: string;
  @ApiProperty({ type: String })
  to!: string;
  @ApiProperty({ type: Number })
  orders!: number;
  @ApiProperty({ type: Number })
  revenueIdr!: number;
  @ApiProperty({ type: Number })
  avgPerDayIdr!: number;
  @ApiProperty({ required: false, type: Number })
  slaOnTimePct?: number;
  @ApiProperty({ type: [DepotWeeklyReportRevenueByDayResponseDto] })
  revenueByDay!: DepotWeeklyReportRevenueByDayResponseDto[];
  @ApiProperty({ type: [DepotWeeklyReportTopProductsResponseDto] })
  topProducts!: DepotWeeklyReportTopProductsResponseDto[];
  @ApiProperty({ required: false, type: DepotWeeklyReportTopCourierResponseDto })
  topCourier?: DepotWeeklyReportTopCourierResponseDto;
}

/** Mirrors `DepotCompareRow` exactly — generated for audit D-6, no field added or removed. */
export class DepotCompareRowResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  orders!: number;
  @ApiProperty({ type: Number })
  revenueIdr!: number;
}

/** Mirrors `DepotCompareReport` exactly — generated for audit D-6, no field added or removed. */
export class DepotCompareReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [DepotCompareRowResponseDto] })
  depots!: DepotCompareRowResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class DepotMonthlyReportTopCourierResponseDto {
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Number })
  delivered!: number;
}

/** Mirrors `DepotMonthlyReport` exactly — generated for audit D-6, no field added or removed. */
export class DepotMonthlyReportResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  month!: string;
  @ApiProperty({ type: Number })
  orders!: number;
  @ApiProperty({ type: Number })
  revenueIdr!: number;
  @ApiProperty({ type: Number })
  activeCustomers!: number;
  @ApiProperty({ type: Number, nullable: true })
  netProfitIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  slaPct!: number | null;
  @ApiProperty({ required: false, type: DepotMonthlyReportTopCourierResponseDto })
  topCourier?: DepotMonthlyReportTopCourierResponseDto;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class AudienceReachResponseDto {
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SegmentEstimateResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: Number, nullable: true })
  recencyDays!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  minOrders!: number | null;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
}

/** Mirrors `ResellerRollupRow` exactly — generated for audit D-6, no field added or removed. */
export class ResellerRollupRowResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Number })
  volumeQty!: number;
  @ApiProperty({ type: Number })
  prevVolumeQty!: number;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: String, nullable: true })
  lastOrderAt!: string | null;
}

/** Mirrors `ResellerRollupReport` exactly — generated for audit D-6, no field added or removed. */
export class ResellerRollupReportResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  month!: string;
  @ApiProperty({ type: [ResellerRollupRowResponseDto] })
  rows!: ResellerRollupRowResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CustomerRecentOrdersResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  orderNumber!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: String })
  createdAt!: string;
}

/** Mirrors `CustomerSummary` exactly — generated for audit D-6, no field added or removed. */
export class CustomerResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
  @ApiProperty({ type: String, nullable: true })
  firstOrderAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastOrderAt!: string | null;
  @ApiProperty({ type: [CustomerRecentOrdersResponseDto] })
  recentOrders!: CustomerRecentOrdersResponseDto[];
}

/** Mirrors `SettingDef` exactly — generated for audit D-6, no field added or removed. */
export class SettingDefResponseDto {
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Object })
  type!: unknown;
  @ApiProperty({ required: false, type: String })
  unit?: string;
  @ApiProperty({ required: false, type: Number })
  min?: number;
  @ApiProperty({ required: false, type: Number })
  max?: number;
  @ApiProperty({ type: Object })
  envDefault!: unknown;
  @ApiProperty({ required: false, type: Boolean })
  global?: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SchemaResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors `SubscriptionPlanCount` exactly — generated for audit D-6, no field added or removed. */
export class SubscriptionPlanCountResponseDto {
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: Object })
  frequency!: unknown;
  @ApiProperty({ type: Number })
  subscribers!: number;
}

/** Mirrors `SubscriptionNetworkSummaryView` exactly — generated for audit D-6, no field added or removed. */
export class SubscriptionNetworkSummaryResponseDto {
  @ApiProperty({ type: Number })
  activeSubscriptions!: number;
  @ApiProperty({ type: Number })
  activeSubscribers!: number;
  @ApiProperty({ type: [SubscriptionPlanCountResponseDto] })
  plans!: SubscriptionPlanCountResponseDto[];
  @ApiProperty({ type: Number })
  estMonthlyDeliveries!: number;
}

/** Mirrors `CartLineView` exactly — generated for audit D-6, no field added or removed. */
export class CartLineResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: String })
  sku!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number })
  unitPrice!: number;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: Number })
  lineTotal!: number;
}

/** Mirrors `CartView` exactly — generated for audit D-6, no field added or removed. */
export class CartResponseDto {
  @ApiProperty({ type: [CartLineResponseDto] })
  items!: CartLineResponseDto[];
  @ApiProperty({ type: Number })
  subtotal!: number;
}

/** Mirrors `MeterReading` exactly — generated for audit D-6, no field added or removed. */
export class MeterReadingResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  date!: string;
  @ApiProperty({ type: Number })
  openingM3!: number;
  @ApiProperty({ type: Number, nullable: true })
  closingM3!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  sourceOpeningM3!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  sourceClosingM3!: number | null;
  @ApiProperty({ type: String })
  openedBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  openedAt!: string;
  @ApiProperty({ type: String, nullable: true })
  closedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  alertedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

/** Mirrors `MeterReconciliation` exactly — generated for audit D-6, no field added or removed. */
export class MeterReconciliationResponseDto {
  @ApiProperty({ type: Number })
  soldLiters!: number;
  @ApiProperty({ type: Number })
  unmeasuredLines!: number;
  @ApiProperty({ type: Number })
  gallonsDelivered!: number;
  @ApiProperty({ type: Number })
  revenueIdr!: number;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  date!: string;
  @ApiProperty({ type: MeterReadingResponseDto, nullable: true })
  reading!: MeterReadingResponseDto | null;
  @ApiProperty({ type: Number, nullable: true })
  meterLiters!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  varianceLiters!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  varianceGallons!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  varianceIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  roYieldPct!: number | null;
  @ApiProperty({ type: Number })
  referenceVolumeMl!: number;
  @ApiProperty({ type: Number })
  toleranceLiters!: number;
  @ApiProperty({ type: Boolean })
  overTolerance!: boolean;
}

/** Mirrors `MeterHistoryRow` exactly — generated for audit D-6, no field added or removed. */
export class MeterHistoryRowResponseDto {
  @ApiProperty({ type: String })
  day!: string;
  @ApiProperty({ type: Number, nullable: true })
  meterLiters!: number | null;
  @ApiProperty({ type: Number })
  soldLiters!: number;
  @ApiProperty({ type: Number, nullable: true })
  varianceLiters!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  varianceGallons!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  roYieldPct!: number | null;
}

/** Mirrors `OrderItemRecord` exactly — generated for audit D-6, no field added or removed. */
export class OrderItemResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: String })
  sku!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number, nullable: true })
  volumeMl!: number | null;
  @ApiProperty({ type: Boolean })
  isGallon!: boolean;
  @ApiProperty({ type: Number })
  unitPrice!: number;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: Number })
  lineTotal!: number;
}

/** Mirrors `OrderStatusHistoryRecord` exactly — generated for audit D-6, no field added or removed. */
export class OrderStatusHistoryResponseDto {
  @ApiProperty({ enum: ['CREATED', 'CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'VOIDED'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  changedBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `OrderRecord` exactly — generated for audit D-6, no field added or removed. */
export class OrderResponseDto {
  @ApiProperty({ type: String })
  recipientName!: string;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: String })
  addressLine!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: String, nullable: true })
  postalCode!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  orderNumber!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ enum: ['CREATED', 'CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'VOIDED'] })
  status!: string;
  @ApiProperty({ type: Number })
  subtotal!: number;
  @ApiProperty({ type: Number })
  deliveryFee!: number;
  @ApiProperty({ type: Number })
  discount!: number;
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: String, nullable: true })
  driverName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  driverPhone!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  estimatedArrivalAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  deliveryWindow!: string | null;
  @ApiProperty({ type: Boolean })
  isWalkIn!: boolean;
  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];
  @ApiProperty({ type: [OrderStatusHistoryResponseDto] })
  history!: OrderStatusHistoryResponseDto[];
  @ApiProperty({ type: Boolean })
  reviewed!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ExpireAbandonedResponseDto {
  @ApiProperty({ type: Number })
  cancelled!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalCompletedOrdersItemsResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: String })
  sku!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalCompletedOrdersResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  completedAt!: string;
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: [InternalCompletedOrdersItemsResponseDto] })
  items!: InternalCompletedOrdersItemsResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalCompletedResponseDto {
  @ApiProperty({ type: [InternalCompletedOrdersResponseDto] })
  orders!: InternalCompletedOrdersResponseDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalDepotSalesResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  totalIdr!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalDepotCustomersCustomersResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  totalSpent!: number;
  @ApiProperty({ type: String, nullable: true })
  firstOrderAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastOrderAt!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalDepotCustomersResponseDto {
  @ApiProperty({ type: [InternalDepotCustomersCustomersResponseDto] })
  customers!: InternalDepotCustomersCustomersResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RemindStaleResponseDto {
  @ApiProperty({ type: Number })
  reminded!: number;
}

/** Mirrors `OrderReviewRecord` exactly — generated for audit D-6, no field added or removed. */
export class OrderReviewResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Number })
  rating!: number;
  @ApiProperty({ type: [String] })
  aspects!: string[];
  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;
  @ApiProperty({ type: Number })
  tipAmount!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalConfirmResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ enum: ['CREATED', 'CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'VOIDED'] })
  status!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalRefundResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalTotalResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: Number })
  total!: number;
}

/** Mirrors `RatingSummary` exactly — generated for audit D-6, no field added or removed. */
export class RatingResponseDto {
  @ApiProperty({ type: Number, nullable: true })
  average!: number | null;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class AudienceReach2ResponseDto {
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SegmentEstimate2ResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: Number, nullable: true })
  recencyDays!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  minOrders!: number | null;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema2ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors `SubscriptionRecord` exactly — generated for audit D-6, no field added or removed. */
export class SubscriptionResponseDto {
  @ApiProperty({ type: String })
  recipientName!: string;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: String })
  addressLine!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: String, nullable: true })
  postalCode!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  latitude!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  longitude!: number | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: Object })
  frequency!: unknown;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ type: String, format: 'date-time' })
  nextDeliveryAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class DiscountResponseDto {
  @ApiProperty({ type: Number })
  rate!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ProcessDueResponseDto {
  @ApiProperty({ type: Number })
  placed!: number;
}

/** Mirrors `Page<OrderRecord>` — the paged envelope this route already returns. */
export class PagedOrderResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  items!: OrderResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `CustomerSales` exactly — generated for audit D-6, no field added or removed. */
export class CustomerSalesResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
}

/** Mirrors the response of this route (`ReportRangeView & { items: CustomerSales[] }`). */
export class TopCustomersResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [CustomerSalesResponseDto] })
  items!: CustomerSalesResponseDto[];
}

/** Mirrors `DepotSales` exactly — generated for audit D-6, no field added or removed. */
export class DepotSalesResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
}

/** Mirrors the response of this route (`ReportRangeView & { items: DepotSales[] }`). */
export class TopDepotsResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [DepotSalesResponseDto] })
  items!: DepotSalesResponseDto[];
}

/** Mirrors `DepotShipping` exactly — generated for audit D-6, no field added or removed. */
export class DepotShippingResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  shippingBilled!: number;
}

/** Mirrors the response of this route (`ReportRangeView & { items: DepotShipping[] }`). */
export class ShippingByDepotResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [DepotShippingResponseDto] })
  items!: DepotShippingResponseDto[];
}

/** Mirrors `DepotRefund` exactly — generated for audit D-6, no field added or removed. */
export class DepotRefundResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  refunded!: number;
}

/** Mirrors the response of this route (`ReportRangeView & { items: DepotRefund[] }`). */
export class RefundsByDepotResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [DepotRefundResponseDto] })
  items!: DepotRefundResponseDto[];
}

/** Mirrors `DepotRating` exactly — generated for audit D-6, no field added or removed. */
export class DepotRatingResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  rating!: number;
  @ApiProperty({ type: Number })
  reviewCount!: number;
}

/** Mirrors the response of this route (`ReportRangeView & { items: DepotRating[] }`). */
export class RatingByDepotResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [DepotRatingResponseDto] })
  items!: DepotRatingResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ExpireAbandoned2ResponseDto {
  @ApiProperty({ type: Number })
  cancelled!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalCompleted2OrdersItemsResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: String })
  sku!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalCompleted2OrdersResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  completedAt!: string;
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: [InternalCompleted2OrdersItemsResponseDto] })
  items!: InternalCompleted2OrdersItemsResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalCompleted2ResponseDto {
  @ApiProperty({ type: [InternalCompleted2OrdersResponseDto] })
  orders!: InternalCompleted2OrdersResponseDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalDepotSales2ResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  totalIdr!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalDepotCustomers2CustomersResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  totalSpent!: number;
  @ApiProperty({ type: String, nullable: true })
  firstOrderAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastOrderAt!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalDepotCustomers2ResponseDto {
  @ApiProperty({ type: [InternalDepotCustomers2CustomersResponseDto] })
  customers!: InternalDepotCustomers2CustomersResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RemindStale2ResponseDto {
  @ApiProperty({ type: Number })
  reminded!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalConfirm2ResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ enum: ['CREATED', 'CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'VOIDED'] })
  status!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalRefund2ResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalTotal2ResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: Number })
  total!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class AudienceReach3ResponseDto {
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SegmentEstimate3ResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
  @ApiProperty({ type: Number, nullable: true })
  recencyDays!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  minOrders!: number | null;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema3ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Discount2ResponseDto {
  @ApiProperty({ type: Number })
  rate!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ProcessDue2ResponseDto {
  @ApiProperty({ type: Number })
  placed!: number;
}

/** Mirrors `DepotDailyRow` exactly — generated for audit D-6, no field added or removed. */
export class DepotDailyRowResponseDto {
  @ApiProperty({ type: String })
  orderNumber!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: Boolean })
  cancelled!: boolean;
  @ApiProperty({ type: String })
  recipientName!: string;
  @ApiProperty({ type: String, nullable: true })
  driverName!: string | null;
  @ApiProperty({ type: Number })
  gallons!: number;
  @ApiProperty({ type: Number })
  subtotalIdr!: number;
  @ApiProperty({ type: Number })
  deliveryFeeIdr!: number;
  @ApiProperty({ type: Number })
  discountIdr!: number;
  @ApiProperty({ type: Number })
  totalIdr!: number;
  @ApiProperty({ type: Boolean })
  isWalkIn!: boolean;
}
