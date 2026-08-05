// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class SalesReportBucketsResponseDto {
  @ApiProperty({ type: String })
  period!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
}

/** Mirrors `SalesReport` exactly — generated for audit D-6, no field added or removed. */
export class SalesReportResponseDto {
  @ApiProperty({ type: String })
  granularity!: string;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [SalesReportBucketsResponseDto] })
  buckets!: SalesReportBucketsResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class TopCustomersItemsResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
}

/** Mirrors `TopCustomers` exactly — generated for audit D-6, no field added or removed. */
export class TopCustomersResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [TopCustomersItemsResponseDto] })
  items!: TopCustomersItemsResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class TopDepotsItemsResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
}

/** Mirrors `TopDepots` exactly — generated for audit D-6, no field added or removed. */
export class TopDepotsResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [TopDepotsItemsResponseDto] })
  items!: TopDepotsItemsResponseDto[];
}

/** Mirrors `DeliverySla` exactly — generated for audit D-6, no field added or removed. */
export class DeliverySlaResponseDto {
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

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ExecutiveDashboardSourcesResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  order!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  delivery!: string;
}

/** Mirrors `ExecutiveDashboard` exactly — generated for audit D-6, no field added or removed. */
export class ExecutiveDashboardResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: SalesReportResponseDto, nullable: true })
  sales!: SalesReportResponseDto | null;
  @ApiProperty({ type: TopCustomersResponseDto, nullable: true })
  topCustomers!: TopCustomersResponseDto | null;
  @ApiProperty({ type: TopDepotsResponseDto, nullable: true })
  topDepots!: TopDepotsResponseDto | null;
  @ApiProperty({ type: DeliverySlaResponseDto, nullable: true })
  deliverySla!: DeliverySlaResponseDto | null;
  @ApiProperty({ type: ExecutiveDashboardSourcesResponseDto })
  sources!: ExecutiveDashboardSourcesResponseDto;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class MonthlyOperationalPnlSourcesResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  order!: string;
  @ApiProperty({ enum: ['ok', 'partial', 'unavailable'] })
  depot!: string;
}

/** Mirrors `MonthlyOperationalPnl` exactly — generated for audit D-6, no field added or removed. */
export class MonthlyOperationalPnlResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  month!: string;
  @ApiProperty({ type: String })
  from!: string;
  @ApiProperty({ type: String })
  to!: string;
  @ApiProperty({ enum: ['OPERATIONAL_MANAGEMENT'] })
  reportType!: string;
  @ApiProperty({ type: String })
  disclaimer!: string;
  @ApiProperty({ type: Number, nullable: true })
  revenueIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  cogsIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  coveredCogsIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  opexIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  grossProfitIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  netOperatingProfitIdr!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  marginPct!: number | null;
  @ApiProperty({ type: Object, nullable: true })
  costCoverage!: unknown | null;
  @ApiProperty({ type: Object, nullable: true })
  opexCoverage!: unknown | null;
  @ApiProperty({ type: MonthlyOperationalPnlSourcesResponseDto })
  sources!: MonthlyOperationalPnlSourcesResponseDto;
}

/** Mirrors `NetworkDepotRow` exactly — generated for audit D-6, no field added or removed. */
export class NetworkDepotRowResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String })
  ownershipType!: string;
  @ApiProperty({ type: Number })
  revenue!: number;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number, nullable: true })
  slaRate!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  avgMinutes!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  rating!: number | null;
  @ApiProperty({ type: Number })
  lowStockCount!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class NetworkDashboardSourcesResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  depot!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  order!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  delivery!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  inventory!: string;
}

/** Mirrors `NetworkDashboard` exactly — generated for audit D-6, no field added or removed. */
export class NetworkDashboardResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [NetworkDepotRowResponseDto] })
  depots!: NetworkDepotRowResponseDto[];
  @ApiProperty({ type: NetworkDashboardSourcesResponseDto })
  sources!: NetworkDashboardSourcesResponseDto;
}

/** Mirrors `FranchiseDepotSummary` exactly — generated for audit D-6, no field added or removed. */
export class FranchiseDepotResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
  @ApiProperty({ type: Number })
  lowStockCount!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class FranchiseDashboardTotalsResponseDto {
  @ApiProperty({ type: Number })
  depotCount!: number;
  @ApiProperty({ type: Number })
  revenue!: number;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  lowStockCount!: number;
}

/** Mirrors `FranchiseHr` exactly — generated for audit D-6, no field added or removed. */
export class FranchiseHrResponseDto {
  @ApiProperty({ type: Number })
  lateToday!: number;
  @ApiProperty({ type: Number })
  absentToday!: number;
  @ApiProperty({ type: Number })
  presentToday!: number;
  @ApiProperty({ type: Number })
  payrollMtdNet!: number;
  @ApiProperty({ type: Number })
  activeHeadcount!: number;
}

/** Mirrors `FranchiseCrm` exactly — generated for audit D-6, no field added or removed. */
export class FranchiseCrmResponseDto {
  @ApiProperty({ type: Number })
  baru!: number;
  @ApiProperty({ type: Number })
  aktif!: number;
  @ApiProperty({ type: Number })
  inactive!: number;
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  followUpCount!: number;
  @ApiProperty({ type: Number })
  repeatRatePct!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class FranchiseDashboardSourcesResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  depot!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  order!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  delivery!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  inventory!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  hr!: string;
  @ApiProperty({ enum: ['ok', 'unavailable'] })
  crm!: string;
}

/** Mirrors `FranchiseDashboard` exactly — generated for audit D-6, no field added or removed. */
export class FranchiseDashboardResponseDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String, nullable: true })
  to!: string | null;
  @ApiProperty({ type: [FranchiseDepotResponseDto] })
  depots!: FranchiseDepotResponseDto[];
  @ApiProperty({ type: FranchiseDashboardTotalsResponseDto })
  totals!: FranchiseDashboardTotalsResponseDto;
  @ApiProperty({ type: DeliverySlaResponseDto, nullable: true })
  deliverySla!: DeliverySlaResponseDto | null;
  @ApiProperty({ type: FranchiseHrResponseDto, nullable: true })
  hr!: FranchiseHrResponseDto | null;
  @ApiProperty({ type: FranchiseCrmResponseDto, nullable: true })
  crm!: FranchiseCrmResponseDto | null;
  @ApiProperty({ type: FranchiseDashboardSourcesResponseDto })
  sources!: FranchiseDashboardSourcesResponseDto;
}
