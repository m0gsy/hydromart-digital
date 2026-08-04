// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';
import { PublicDepotView } from './depot.dto';

/** Mirrors `Approval` exactly — generated for audit D-6, no field added or removed. */
export class ApprovalResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['OPNAME_VARIANCE', 'DEPOSIT_REFUND', 'COD_VARIANCE', 'GALLON_VARIANCE'] })
  type!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'HELD'] })
  status!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String })
  submittedBy!: string;
  @ApiProperty({ type: String, nullable: true })
  subjectRef!: string | null;
  @ApiProperty({ type: Number })
  amountIdr!: number;
  @ApiProperty({ type: Object })
  payload!: unknown;
  @ApiProperty({ type: Number })
  autoPassThreshold!: number;
  @ApiProperty({ type: String, nullable: true })
  decisionNote!: string | null;
  @ApiProperty({ type: String, nullable: true })
  decidedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  decidedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class CountsResponseDto {
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Object })
  byType!: unknown;
}

/** Mirrors `CashbookEntry` exactly — generated for audit D-6, no field added or removed. */
export class CashbookEntryResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['IN', 'OUT'] })
  direction!: string;
  @ApiProperty({ type: String })
  category!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  amountIdr!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;
  @ApiProperty({ type: String, nullable: true })
  sourceRef!: string | null;
  @ApiProperty({ type: String })
  actorId!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `CashbookView` exactly — generated for audit D-6, no field added or removed. */
export class CashbookResponseDto {
  @ApiProperty({ type: [CashbookEntryResponseDto] })
  entries!: CashbookEntryResponseDto[];
  @ApiProperty({ type: CashbookResponseDto })
  summary!: CashbookResponseDto;
}

/** Mirrors `CashierShift` exactly — generated for audit D-6, no field added or removed. */
export class CashierShiftResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  cashierId!: string;
  @ApiProperty({ type: String })
  cashierName!: string;
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] })
  status!: string;
  @ApiProperty({ type: Number })
  openingFloat!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  openedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  countedCash!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  expectedCash!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  variance!: number | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListResponseDto {
  @ApiProperty({ type: [CashierShiftResponseDto] })
  open!: CashierShiftResponseDto[];
  @ApiProperty({ type: [CashierShiftResponseDto] })
  closed!: CashierShiftResponseDto[];
}

/** Mirrors `DepotTarget` exactly — generated for audit D-6, no field added or removed. */
export class DepotTargetResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  month!: string;
  @ApiProperty({ type: Number })
  revenueTargetIdr!: number;
  @ApiProperty({ type: Number })
  ordersTarget!: number;
  @ApiProperty({ type: Number })
  slaTargetPct!: number;
  @ApiProperty({ type: Number })
  newCustomersTarget!: number;
  @ApiProperty({ type: String })
  updatedBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `Page<PublicDepotView>` — the paged envelope this route already returns. */
export class PagedPublicDepotResponseDto {
  @ApiProperty({ type: [PublicDepotView] })
  items!: PublicDepotView[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `Holiday` exactly — generated for audit D-6, no field added or removed. */
export class HolidayResponseDto {
  @ApiProperty({ type: String })
  date!: string;
  @ApiProperty({ required: false, type: String })
  label?: string;
}

/** Mirrors `NearbyDepot` exactly — generated for audit D-6, no field added or removed. */
export class NearbyDepotResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ enum: ['WARALABA', 'HKP'] })
  ownershipType!: string;
  @ApiProperty({ type: String })
  address!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
  @ApiProperty({ type: Number })
  serviceRadiusKm!: number;
  @ApiProperty({ type: Number })
  deliveryFee!: number;
  @ApiProperty({ type: Number, nullable: true })
  minOrderAmount!: number | null;
  @ApiProperty({ type: String, nullable: true })
  ownerId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  assistantSupervisorId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentBankName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentBankAccountNumber!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentBankAccountHolder!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentQrisImageUrl!: string | null;
  @ApiProperty({ type: Object })
  operatingHours!: unknown;
  @ApiProperty({ type: [HolidayResponseDto] })
  holidays!: HolidayResponseDto[];
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: Number })
  distanceKm!: number;
  @ApiProperty({ type: Boolean })
  withinService!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalOwnedResponseDto {
  @ApiProperty({ type: [String] })
  depotIds!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class InternalOwnerResponseDto {
  @ApiProperty({ type: String, nullable: true })
  ownerId!: string | null;
  @ApiProperty({ enum: ['WARALABA', 'HKP'] })
  ownershipType!: string;
}

/** Mirrors `DepotRecord` exactly — generated for audit D-6, no field added or removed. */
export class DepotResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ enum: ['WARALABA', 'HKP'] })
  ownershipType!: string;
  @ApiProperty({ type: String })
  address!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
  @ApiProperty({ type: Number })
  serviceRadiusKm!: number;
  @ApiProperty({ type: Number })
  deliveryFee!: number;
  @ApiProperty({ type: Number, nullable: true })
  minOrderAmount!: number | null;
  @ApiProperty({ type: String, nullable: true })
  ownerId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  assistantSupervisorId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentBankName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentBankAccountNumber!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentBankAccountHolder!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentQrisImageUrl!: string | null;
  @ApiProperty({ type: Object })
  operatingHours!: unknown;
  @ApiProperty({ type: [HolidayResponseDto] })
  holidays!: HolidayResponseDto[];
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `Page<DepotRecord>` — the paged envelope this route already returns. */
export class PagedDepotResponseDto {
  @ApiProperty({ type: [DepotResponseDto] })
  items!: DepotResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `OrderDispute` exactly — generated for audit D-6, no field added or removed. */
export class OrderDisputeResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  orderRef!: string;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ enum: ['WRONG_ITEM', 'NOT_RECEIVED', 'OVERCHARGED', 'QUALITY', 'OTHER'] })
  category!: string;
  @ApiProperty({ type: String })
  description!: string;
  @ApiProperty({ type: Number })
  amountIdr!: number;
  @ApiProperty({ type: String, nullable: true })
  courierName!: string | null;
  @ApiProperty({ enum: ['OPEN', 'RESOLVED', 'REJECTED'] })
  status!: string;
  @ApiProperty({ enum: ['REFUND', 'RESEND', 'REJECTED'], nullable: true })
  resolution!: string | null;
  @ApiProperty({ type: String, nullable: true })
  resolutionNote!: string | null;
  @ApiProperty({ type: String })
  raisedBy!: string;
  @ApiProperty({ type: String, nullable: true })
  resolvedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `GallonReturnRecord` exactly — generated for audit D-6, no field added or removed. */
export class GallonReturnResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  customerId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  orderId!: string | null;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ enum: ['GOOD', 'DAMAGED'] })
  condition!: string;
  @ApiProperty({ type: Number })
  depositRefunded!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String })
  actorId!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `FranchiseApplicationRecord` exactly — generated for audit D-6, no field added or removed. */
export class FranchiseApplicationResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  applicantName!: string;
  @ApiProperty({ type: String })
  applicantPhone!: string;
  @ApiProperty({ type: String })
  proposedCode!: string;
  @ApiProperty({ type: String })
  proposedName!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
  @ApiProperty({ type: Number })
  investmentAmount!: number;
  @ApiProperty({ type: Number })
  projectedMonthlyRevenue!: number;
  @ApiProperty({ type: Object })
  checklist!: unknown;
  @ApiProperty({ enum: ['PENDING', 'DOC_VERIFICATION', 'SURVEY', 'APPROVED', 'REJECTED'] })
  stage!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  submittedAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `Page<FranchiseApplicationRecord>` — the paged envelope this route already returns. */
export class PagedFranchiseApplicationResponseDto {
  @ApiProperty({ type: [FranchiseApplicationResponseDto] })
  items!: FranchiseApplicationResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `ProposedDepot` exactly — generated for audit D-6, no field added or removed. */
export class ProposedDepotResponseDto {
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ enum: ['WARALABA'] })
  ownershipType!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  province!: string;
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
}

/** Mirrors `ApproveResult` exactly — generated for audit D-6, no field added or removed. */
export class ApproveResponseDto {
  @ApiProperty({ type: FranchiseApplicationResponseDto })
  application!: FranchiseApplicationResponseDto;
  @ApiProperty({ type: ProposedDepotResponseDto })
  proposedDepot!: ProposedDepotResponseDto;
}

/** Mirrors `GallonIssueRecord` exactly — generated for audit D-6, no field added or removed. */
export class GallonIssueResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  customerId!: string | null;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: Number })
  depositHeld!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String })
  actorId!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `Page<GallonIssueRecord>` — the paged envelope this route already returns. */
export class PagedGallonIssueResponseDto {
  @ApiProperty({ type: [GallonIssueResponseDto] })
  items!: GallonIssueResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `GallonOutstandingRow` exactly — generated for audit D-6, no field added or removed. */
export class GallonOutstandingRowResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  issued!: number;
  @ApiProperty({ type: Number })
  returned!: number;
  @ApiProperty({ type: Number })
  outstanding!: number;
  @ApiProperty({ type: Number })
  depositHeld!: number;
  @ApiProperty({ type: Number })
  depositRefunded!: number;
  @ApiProperty({ type: Number })
  netDeposit!: number;
}

/** Mirrors `Page<GallonReturnRecord>` — the paged envelope this route already returns. */
export class PagedGallonReturnResponseDto {
  @ApiProperty({ type: [GallonReturnResponseDto] })
  items!: GallonReturnResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `HandoverItem` exactly — generated for audit D-6, no field added or removed. */
export class HandoverItemResponseDto {
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String })
  subtext!: string;
  @ApiProperty({ enum: ['DONE', 'PARTIAL', 'PENDING'] })
  state!: string;
}

/** Mirrors `ShiftHandover` exactly — generated for audit D-6, no field added or removed. */
export class ShiftHandoverResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  fromShift!: string;
  @ApiProperty({ type: String })
  toShift!: string;
  @ApiProperty({ type: String })
  fromStaff!: string;
  @ApiProperty({ type: String })
  toStaff!: string;
  @ApiProperty({ type: [HandoverItemResponseDto] })
  items!: HandoverItemResponseDto[];
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  signedAt!: string | null;
  @ApiProperty({ type: String })
  recordedBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `HuddleAgendaItem` exactly — generated for audit D-6, no field added or removed. */
export class HuddleAgendaItemResponseDto {
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String })
  note!: string;
}

/** Mirrors `HuddleActionItem` exactly — generated for audit D-6, no field added or removed. */
export class HuddleActionItemResponseDto {
  @ApiProperty({ type: String })
  text!: string;
  @ApiProperty({ type: String })
  assignee!: string;
  @ApiProperty({ type: Boolean })
  done!: boolean;
}

/** Mirrors `HuddleNote` exactly — generated for audit D-6, no field added or removed. */
export class HuddleNoteResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  weekStart!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  heldAt!: string;
  @ApiProperty({ type: String, nullable: true })
  attendance!: string | null;
  @ApiProperty({ type: [HuddleAgendaItemResponseDto] })
  agenda!: HuddleAgendaItemResponseDto[];
  @ApiProperty({ type: [HuddleActionItemResponseDto] })
  actionItems!: HuddleActionItemResponseDto[];
  @ApiProperty({ type: String })
  recordedBy!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `Incident` exactly — generated for audit D-6, no field added or removed. */
export class IncidentResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['COURIER_FALL', 'VEHICLE_BREAKDOWN', 'CUSTOMER_CONFLICT', 'POWER_OUTAGE', 'GALLON_DAMAGE', 'OTHER'] })
  type!: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] })
  severity!: string;
  @ApiProperty({ enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] })
  status!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ type: String })
  reportedBy!: string;
  @ApiProperty({ type: String, nullable: true })
  courierName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  orderRef!: string | null;
  @ApiProperty({ type: String, nullable: true })
  resolutionNote!: string | null;
  @ApiProperty({ type: String, nullable: true })
  resolvedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `ItemView` exactly — generated for audit D-6, no field added or removed. */
export class ItemResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ enum: ['AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK'] })
  itemType!: string;
  @ApiProperty({ type: String, nullable: true })
  productId!: string | null;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: Number })
  reserved!: number;
  @ApiProperty({ type: Number })
  minimumStock!: number;
  @ApiProperty({ type: Number, nullable: true })
  sellPrice!: number | null;
  @ApiProperty({ type: Boolean })
  hidden!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: Boolean })
  lowStock!: boolean;
  @ApiProperty({ type: Number })
  available!: number;
}

/** Mirrors `ImportRowResult` exactly — generated for audit D-6, no field added or removed. */
export class ImportRowResponseDto {
  @ApiProperty({ type: Number })
  row!: number;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ required: false, type: String })
  message?: string;
  @ApiProperty({ required: false, type: String })
  id?: string;
}

/** Mirrors `ImportSummary` exactly — generated for audit D-6, no field added or removed. */
export class ImportResponseDto {
  @ApiProperty({ type: Number })
  created!: number;
  @ApiProperty({ type: Number })
  updated!: number;
  @ApiProperty({ type: Number })
  skipped!: number;
  @ApiProperty({ type: Number })
  failed!: number;
  @ApiProperty({ type: [ImportRowResponseDto] })
  results!: ImportRowResponseDto[];
}

/** Mirrors `ResolvedProductPrice` exactly — generated for audit D-6, no field added or removed. */
export class ResolvedProductPriceResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ required: false, type: Number })
  sellPrice?: number;
  @ApiProperty({ required: false, enum: ['PERCENT', 'FIXED'] })
  adjustType?: string;
  @ApiProperty({ required: false, type: Number })
  value?: number;
  @ApiProperty({ required: false, type: Number })
  tierPrice?: number;
}

/** Mirrors `DepotStockMovementRecord` exactly — generated for audit D-6, no field added or removed. */
export class DepotStockMovementResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  itemId!: string;
  @ApiProperty({ enum: ['RECEIPT', 'ADJUSTMENT', 'OPNAME', 'SALE'] })
  type!: string;
  @ApiProperty({ type: Number })
  delta!: number;
  @ApiProperty({ type: Number })
  quantityBefore!: number;
  @ApiProperty({ type: Number })
  quantityAfter!: number;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: String })
  actorId!: string;
  @ApiProperty({ type: String, nullable: true })
  orderId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String })
  itemLabel!: string;
  @ApiProperty({ enum: ['AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK'] })
  itemType!: string;
}

/** Mirrors `Page<DepotStockMovementRecord>` — the paged envelope this route already returns. */
export class PagedDepotStockMovementResponseDto {
  @ApiProperty({ type: [DepotStockMovementResponseDto] })
  items!: DepotStockMovementResponseDto[];
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
export class ConsumeResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: [String] })
  consumed!: string[];
  @ApiProperty({ type: [String] })
  skipped!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ReserveResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: [String] })
  reserved!: string[];
  @ApiProperty({ type: [String] })
  skipped!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RestockResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: [String] })
  restocked!: string[];
  @ApiProperty({ type: [String] })
  skipped!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ReleaseResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: [String] })
  released!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ProductChangedResponseDto {
  @ApiProperty({ type: Number })
  renamed!: number;
  @ApiProperty({ type: Number })
  hidden!: number;
}

/** Mirrors `WastageItem` exactly — generated for audit D-6, no field added or removed. */
export class WastageItemResponseDto {
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  qty!: number;
  @ApiProperty({ required: false, type: Number })
  lossIdr?: number;
}

/** Mirrors `WastageSummary` exactly — generated for audit D-6, no field added or removed. */
export class WastageResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ required: false, type: Number })
  totalLossIdr?: number;
  @ApiProperty({ type: [WastageItemResponseDto] })
  byItem!: WastageItemResponseDto[];
}

/** Mirrors `ReservationRecord` exactly — generated for audit D-6, no field added or removed. */
export class ReservationResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  itemId!: string;
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ enum: ['ACTIVE', 'RELEASED', 'CONSUMED'] })
  status!: string;
}

/** Mirrors `StockMovementRecord` exactly — generated for audit D-6, no field added or removed. */
export class StockMovementResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  itemId!: string;
  @ApiProperty({ enum: ['RECEIPT', 'ADJUSTMENT', 'OPNAME', 'SALE'] })
  type!: string;
  @ApiProperty({ type: Number })
  delta!: number;
  @ApiProperty({ type: Number })
  quantityBefore!: number;
  @ApiProperty({ type: Number })
  quantityAfter!: number;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: String })
  actorId!: string;
  @ApiProperty({ type: String, nullable: true })
  orderId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `MaintenanceItem` exactly — generated for audit D-6, no field added or removed. */
export class MaintenanceItemResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  category!: string;
  @ApiProperty({ type: Number })
  intervalDays!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastServicedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  nextDueAt!: string;
  @ApiProperty({ enum: ['DUE', 'SOON', 'HEALTHY', 'NEW'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class OperationalCostReportCogsUncoveredItemsResponseDto {
  @ApiProperty({ type: String })
  itemId!: string;
  @ApiProperty({ type: String })
  itemType!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  units!: number;
  @ApiProperty({ type: Object })
  reason!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class OperationalCostReportCogsResponseDto {
  @ApiProperty({ type: Number, nullable: true })
  amountIdr!: number | null;
  @ApiProperty({ type: Number })
  coveredAmountIdr!: number;
  @ApiProperty({ type: Number })
  totalUnits!: number;
  @ApiProperty({ type: Number })
  coveredUnits!: number;
  @ApiProperty({ type: Number })
  uncoveredUnits!: number;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ enum: ['LATEST_RECEIVED_DIRECT_PRODUCT_COST'] })
  valuationMethod!: string;
  @ApiProperty({ type: [OperationalCostReportCogsUncoveredItemsResponseDto] })
  uncoveredItems!: OperationalCostReportCogsUncoveredItemsResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class OperationalCostReportOpexResponseDto {
  @ApiProperty({ type: Number, nullable: true })
  amountIdr!: number | null;
  @ApiProperty({ type: Number })
  coveredAmountIdr!: number;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ type: Number })
  includedEntries!: number;
  @ApiProperty({ type: Number })
  excludedProcurementAmountIdr!: number;
  @ApiProperty({ type: Number })
  excludedProcurementEntries!: number;
  @ApiProperty({ type: Number })
  unverifiedProcurementAmountIdr!: number;
  @ApiProperty({ type: Number })
  unverifiedProcurementEntries!: number;
  @ApiProperty({ enum: ['NORMALIZED_CATEGORY_PO_AND_RECEIVED_PO_SOURCE_REF'] })
  exclusionRule!: string;
}

/** Mirrors `OperationalCostReport` exactly — generated for audit D-6, no field added or removed. */
export class OperationalCostReportResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  from!: string;
  @ApiProperty({ type: String })
  to!: string;
  @ApiProperty({ enum: ['OPERATIONAL_MANAGEMENT'] })
  reportType!: string;
  @ApiProperty({ type: String })
  disclaimer!: string;
  @ApiProperty({ type: OperationalCostReportCogsResponseDto })
  cogs!: OperationalCostReportCogsResponseDto;
  @ApiProperty({ type: OperationalCostReportOpexResponseDto })
  opex!: OperationalCostReportOpexResponseDto;
}

/** Mirrors `PriceOverrideProposalRecord` exactly — generated for audit D-6, no field added or removed. */
export class PriceOverrideProposalResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  depotName!: string;
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: Number })
  currentPrice!: number;
  @ApiProperty({ enum: ['PERCENT', 'FIXED'] })
  adjustType!: string;
  @ApiProperty({ type: Number })
  value!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  status!: string;
  @ApiProperty({ type: String })
  proposedBy!: string;
  @ApiProperty({ type: String, nullable: true })
  decidedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `Page<PriceOverrideProposalRecord>` — the paged envelope this route already returns. */
export class PagedPriceOverrideProposalResponseDto {
  @ApiProperty({ type: [PriceOverrideProposalResponseDto] })
  items!: PriceOverrideProposalResponseDto[];
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
export class CountByProductResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors `PricingRuleRecord` exactly — generated for audit D-6, no field added or removed. */
export class PricingRuleResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  productId!: string | null;
  @ApiProperty({ enum: ['PERCENT', 'FIXED'] })
  adjustType!: string;
  @ApiProperty({ type: Number })
  value!: number;
  @ApiProperty({ type: [Number] })
  daysOfWeek!: number[];
  @ApiProperty({ type: Number, nullable: true })
  startMinute!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  endMinute!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validFrom!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validUntil!: string | null;
  @ApiProperty({ type: Number })
  priority!: number;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RemoveResponseDto {
  @ApiProperty({ type: Boolean })
  deleted!: boolean;
}

/** Mirrors `PoLine` exactly — generated for audit D-6, no field added or removed. */
export class PoLineResponseDto {
  @ApiProperty({ enum: ['AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK'] })
  itemType!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: Number })
  unitCostIdr!: number;
}

/** Mirrors `PurchaseOrder` exactly — generated for audit D-6, no field added or removed. */
export class PurchaseOrderResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  poNumber!: string;
  @ApiProperty({ type: String })
  supplierId!: string;
  @ApiProperty({ type: String })
  supplierName!: string;
  @ApiProperty({ enum: ['DRAFT', 'SENT', 'RECEIVED'] })
  status!: string;
  @ApiProperty({ type: [PoLineResponseDto] })
  lines!: PoLineResponseDto[];
  @ApiProperty({ type: Number })
  subtotalIdr!: number;
  @ApiProperty({ type: Number })
  shippingIdr!: number;
  @ApiProperty({ type: Number })
  totalIdr!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expectedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  receivedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `ShiftAssignment` exactly — generated for audit D-6, no field added or removed. */
export class ShiftAssignmentResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  staffId!: string;
  @ApiProperty({ type: String })
  staffName!: string;
  @ApiProperty({ type: String })
  weekStart!: string;
  @ApiProperty({ type: Number })
  day!: number;
  @ApiProperty({ enum: ['MORNING', 'EVENING', 'OFF'] })
  shift!: string;
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

/** Mirrors `Subscription` exactly — generated for audit D-6, no field added or removed. */
export class SubscriptionResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  customerId!: string | null;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ type: String })
  productLabel!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ enum: ['DAILY', 'EVERY_3_DAYS', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] })
  cadence!: string;
  @ApiProperty({ enum: ['ACTIVE', 'PAUSED', 'CANCELLED'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextRunAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `Supplier` exactly — generated for audit D-6, no field added or removed. */
export class SupplierResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String, nullable: true })
  contactPhone!: string | null;
  @ApiProperty({ type: [String] })
  categories!: string[];
  @ApiProperty({ type: Number, nullable: true })
  onTimeRate!: number | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `WholesaleTier` exactly — generated for audit D-6, no field added or removed. */
export class WholesaleTierResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  productId!: string | null;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Number })
  minQty!: number;
  @ApiProperty({ type: Number, nullable: true })
  maxQty!: number | null;
  @ApiProperty({ type: Number })
  priceIdr!: number;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
