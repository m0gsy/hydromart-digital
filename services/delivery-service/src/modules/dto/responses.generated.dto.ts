// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `SlaReport` exactly — generated for audit D-6, no field added or removed. */
export class SlaReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: Number })
  thresholdMinutes!: number;
  @ApiProperty({ type: Number })
  totalDelivered!: number;
  @ApiProperty({ type: Number })
  onTime!: number;
  @ApiProperty({ type: Number })
  breached!: number;
  @ApiProperty({ type: Number })
  slaRate!: number;
  @ApiProperty({ type: Number, nullable: true })
  avgMinutes!: number | null;
  @ApiProperty({ type: Number })
  failedCount!: number;
}

/** Mirrors `DepotSlaRow` exactly — generated for audit D-6, no field added or removed. */
export class DepotSlaRowResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  totalDelivered!: number;
  @ApiProperty({ type: Number })
  onTime!: number;
  @ApiProperty({ type: Number })
  breached!: number;
  @ApiProperty({ type: Number })
  slaRate!: number;
  @ApiProperty({ type: Number, nullable: true })
  avgMinutes!: number | null;
}

/** Mirrors `DepotSlaReport` exactly — generated for audit D-6, no field added or removed. */
export class DepotSlaReportResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: Number })
  thresholdMinutes!: number;
  @ApiProperty({ type: [DepotSlaRowResponseDto] })
  depots!: DepotSlaRowResponseDto[];
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

/** Mirrors `CourierCommissionRow` exactly — generated for audit D-6, no field added or removed. */
export class CourierCommissionRowResponseDto {
  @ApiProperty({ type: String })
  courierId!: string;
  @ApiProperty({ type: Number })
  delivered!: number;
  @ApiProperty({ type: Number })
  ratePerDeliveryIdr!: number;
  @ApiProperty({ type: Number })
  grossIdr!: number;
  @ApiProperty({ type: Number })
  shortfallIdr!: number;
  @ApiProperty({ type: Number })
  netIdr!: number;
}

/** Mirrors `CommissionRun` exactly — generated for audit D-6, no field added or removed. */
export class CommissionRunResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  from!: string;
  @ApiProperty({ type: String })
  to!: string;
  @ApiProperty({ type: Number })
  ratePerDeliveryIdr!: number;
  @ApiProperty({ type: [CourierCommissionRowResponseDto] })
  couriers!: CourierCommissionRowResponseDto[];
  @ApiProperty({ type: Number })
  totalIdr!: number;
}

/** Mirrors `DeliveryItem` exactly — generated for audit D-6, no field added or removed. */
export class DeliveryItemResponseDto {
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Number })
  qty!: number;
}

/** Mirrors `ProofRecord` exactly — generated for audit D-6, no field added or removed. */
export class ProofResponseDto {
  @ApiProperty({ type: String })
  photoUrl!: string;
  @ApiProperty({ type: String, nullable: true })
  signatureUrl!: string | null;
  @ApiProperty({ type: String })
  recipientName!: string;
  @ApiProperty({ type: Number })
  latitude!: number;
  @ApiProperty({ type: Number })
  longitude!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  capturedAt!: string;
}

/** Mirrors `DeliveryStatusHistoryRecord` exactly — generated for audit D-6, no field added or removed. */
export class DeliveryStatusHistoryResponseDto {
  @ApiProperty({ enum: ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'FAILED', 'RESCHEDULED'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  changedBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `DeliveryRecord` exactly — generated for audit D-6, no field added or removed. */
export class DeliveryResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  orderNumber!: string;
  @ApiProperty({ type: String })
  driverId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ enum: ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'FAILED', 'RESCHEDULED'] })
  status!: string;
  @ApiProperty({ type: String })
  destinationAddress!: string;
  @ApiProperty({ type: Number, nullable: true })
  destinationLat!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  destinationLng!: number | null;
  @ApiProperty({ type: String, nullable: true })
  recipientPhone!: string | null;
  @ApiProperty({ type: [DeliveryItemResponseDto], nullable: true })
  items!: DeliveryItemResponseDto[] | null;
  @ApiProperty({ type: Number, nullable: true })
  codAmount!: number | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  lastLat!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  lastLng!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLocationAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  estimatedArrivalAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pickedUpAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deliveredAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  failedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  failureReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  rescheduledFor!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rescheduleSlot!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rescheduleNote!: string | null;
  @ApiProperty({ type: ProofResponseDto, nullable: true })
  proof!: ProofResponseDto | null;
  @ApiProperty({ type: [DeliveryStatusHistoryResponseDto] })
  history!: DeliveryStatusHistoryResponseDto[];
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `NoShowStatus` exactly — generated for audit D-6, no field added or removed. */
export class NoShowStatusResponseDto {
  @ApiProperty({ type: Number })
  attempts!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  eligibleAt!: string | null;
  @ApiProperty({ type: Boolean })
  canMarkNoShow!: boolean;
}

/** Mirrors `CourierPerformance` exactly — generated for audit D-6, no field added or removed. */
export class CourierPerformanceResponseDto {
  @ApiProperty({ type: String })
  weekStart!: string;
  @ApiProperty({ type: Number })
  delivered!: number;
  @ApiProperty({ type: Number })
  deliveredPrev!: number;
  @ApiProperty({ type: [Number] })
  perDay!: number[];
  @ApiProperty({ type: Number })
  onTime!: number;
  @ApiProperty({ type: Number })
  onTimeRate!: number;
  @ApiProperty({ type: Number })
  failed!: number;
  @ApiProperty({ type: Number, nullable: true })
  rating!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  ratingPrev!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  rank!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  rankPrev!: number | null;
  @ApiProperty({ type: Number })
  depotCouriers!: number;
  @ApiProperty({ type: Number })
  target!: number;
  @ApiProperty({ type: Boolean })
  targetMet!: boolean;
}

/** Mirrors `SettlementRecord` exactly — generated for audit D-6, no field added or removed. */
export class SettlementResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  shiftId!: string;
  @ApiProperty({ type: String })
  driverId!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['SUBMITTED', 'VERIFIED', 'DISPUTED'] })
  status!: string;
  @ApiProperty({ type: [String] })
  orderIds!: string[];
  @ApiProperty({ type: Number })
  expectedAmount!: number;
  @ApiProperty({ type: Number })
  depositedAmount!: number;
  @ApiProperty({ type: Number })
  variance!: number;
  @ApiProperty({ type: Boolean })
  chargedToDriver!: boolean;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, nullable: true })
  verifiedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `ShiftView` exactly — generated for audit D-6, no field added or removed. */
export class ShiftResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  driverId!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['ONLINE', 'BREAK', 'OFFLINE', 'ENDED'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  checkInAt!: string;
  @ApiProperty({ type: Number })
  checkInLat!: number;
  @ApiProperty({ type: Number })
  checkInLng!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  expectedEndAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkOutAt!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  checkOutLat!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  checkOutLng!: number | null;
  @ApiProperty({ type: Number })
  breakSecondsUsed!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  breakStartedAt!: string | null;
  @ApiProperty({ type: Number })
  breakSecondsRemaining!: number;
  @ApiProperty({ type: Boolean })
  acceptsAssignments!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeExpiredResponseDto {
  @ApiProperty({ type: Number })
  purged!: number;
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema2ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class UploadResponseDto {
  @ApiProperty({ type: String })
  url!: string;
}

/** Mirrors `Page<DeliveryRecord>` — the paged envelope this route already returns. */
export class PagedDeliveryResponseDto {
  @ApiProperty({ type: [DeliveryResponseDto] })
  items!: DeliveryResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeExpired2ResponseDto {
  @ApiProperty({ type: Number })
  purged!: number;
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema3ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Upload2ResponseDto {
  @ApiProperty({ type: String })
  url!: string;
}

/** Mirrors `DepositedCod` exactly — generated for audit D-6, no field added or removed. */
export class DepositedCodResponseDto {
  @ApiProperty({ type: Number })
  depositedIdr!: number;
  @ApiProperty({ type: Number })
  expectedIdr!: number;
  @ApiProperty({ type: Number })
  settlements!: number;
}
