// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

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

/** Mirrors `CommissionSchemeRecord` exactly — generated for audit D-6, no field added or removed. */
export class CommissionSchemeResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String, nullable: true })
  ownerName!: string | null;
  @ApiProperty({ type: Number })
  pct!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  effectiveDate!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `CourierLedgerEntryRecord` exactly — generated for audit D-6, no field added or removed. */
export class CourierLedgerEntryResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  courierId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Object })
  type!: unknown;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: String })
  description!: string;
  @ApiProperty({ type: String, nullable: true })
  sourceRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `CourierWithdrawalRecord` exactly — generated for audit D-6, no field added or removed. */
export class CourierWithdrawalResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  courierId!: string;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: String })
  bankAccountRef!: string;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ type: String })
  reference!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `CourierEarningsSummary` exactly — generated for audit D-6, no field added or removed. */
export class CourierEarningsResponseDto {
  @ApiProperty({ type: Number })
  availableBalance!: number;
  @ApiProperty({ type: Number })
  monthEarnings!: number;
  @ApiProperty({ type: [CourierLedgerEntryResponseDto] })
  recentEntries!: CourierLedgerEntryResponseDto[];
  @ApiProperty({ type: [CourierWithdrawalResponseDto] })
  recentWithdrawals!: CourierWithdrawalResponseDto[];
}

/** Mirrors `IncentiveTier` exactly — generated for audit D-6, no field added or removed. */
export class IncentiveTierResponseDto {
  @ApiProperty({ type: Number })
  deliveries!: number;
  @ApiProperty({ type: Number })
  bonus!: number;
}

/** Mirrors `CourierEarningRuleRecord` exactly — generated for audit D-6, no field added or removed. */
export class CourierEarningRuleResponseDto {
  @ApiProperty({ type: Number })
  baseFare!: number;
  @ApiProperty({ type: Number })
  peakBonus!: number;
  @ApiProperty({ type: Number })
  onTimeBonus!: number;
  @ApiProperty({ type: Number })
  peakStartHour!: number;
  @ApiProperty({ type: Number })
  peakEndHour!: number;
  @ApiProperty({ type: Number })
  monthlyTarget!: number;
  @ApiProperty({ type: [IncentiveTierResponseDto] })
  tiers!: IncentiveTierResponseDto[];
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  effectiveDate!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `ExpenseClaimRecord` exactly — generated for audit D-6, no field added or removed. */
export class ExpenseClaimResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  courierId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Object })
  category!: unknown;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: String })
  description!: string;
  @ApiProperty({ type: String, nullable: true })
  receiptUrl!: string | null;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ type: String, nullable: true })
  reviewedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reviewNote!: string | null;
  @ApiProperty({ type: String, nullable: true })
  ledgerEntryId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RecordEarningResponseDto {
  @ApiProperty({ type: Boolean })
  recorded!: boolean;
}

/** Mirrors `PendingPayout` exactly — generated for audit D-6, no field added or removed. */
export class PendingPayoutResponseDto {
  @ApiProperty({ type: String })
  franchiseOwnerId!: string;
  @ApiProperty({ type: Number })
  availableBalance!: number;
  @ApiProperty({ type: String })
  nextPayoutDate!: string;
}

/** Mirrors `WithdrawalRecord` exactly — generated for audit D-6, no field added or removed. */
export class WithdrawalResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  franchiseOwnerId!: string;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: String })
  bankAccountRef!: string;
  @ApiProperty({ type: Object })
  status!: unknown;
  @ApiProperty({ type: String })
  reference!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `LedgerEntryRecord` exactly — generated for audit D-6, no field added or removed. */
export class LedgerEntryResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  franchiseOwnerId!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Object })
  type!: unknown;
  @ApiProperty({ type: Number })
  amount!: number;
  @ApiProperty({ type: String })
  description!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Mirrors `PayoutSummary` exactly — generated for audit D-6, no field added or removed. */
export class PayoutResponseDto {
  @ApiProperty({ type: Number })
  availableBalance!: number;
  @ApiProperty({ type: Number })
  monthRevenue!: number;
  @ApiProperty({ type: Number })
  monthCommission!: number;
  @ApiProperty({ type: String })
  nextPayoutDate!: string;
  @ApiProperty({ type: [LedgerEntryResponseDto] })
  recentEntries!: LedgerEntryResponseDto[];
  @ApiProperty({ type: [WithdrawalResponseDto] })
  recentWithdrawals!: WithdrawalResponseDto[];
}

/** Mirrors `OrderRevenueResult` exactly — generated for audit D-6, no field added or removed. */
export class OrderRevenueResponseDto {
  @ApiProperty({ type: Boolean })
  recorded!: boolean;
  @ApiProperty({ type: Number })
  revenue!: number;
  @ApiProperty({ type: Number })
  commission!: number;
  @ApiProperty({ type: Number })
  commissionPct!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class VoidRevenueResponseDto {
  @ApiProperty({ type: Boolean })
  reversed!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema2ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors `Page<CourierLedgerEntryRecord>` — the paged envelope this route already returns. */
export class PagedCourierLedgerEntryResponseDto {
  @ApiProperty({ type: [CourierLedgerEntryResponseDto] })
  items!: CourierLedgerEntryResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `Page<ExpenseClaimRecord>` — the paged envelope this route already returns. */
export class PagedExpenseClaimResponseDto {
  @ApiProperty({ type: [ExpenseClaimResponseDto] })
  items!: ExpenseClaimResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `Page<LedgerEntryRecord>` — the paged envelope this route already returns. */
export class PagedLedgerEntryResponseDto {
  @ApiProperty({ type: [LedgerEntryResponseDto] })
  items!: LedgerEntryResponseDto[];
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
export class RecordEarning2ResponseDto {
  @ApiProperty({ type: Boolean })
  recorded!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class VoidRevenue2ResponseDto {
  @ApiProperty({ type: Boolean })
  reversed!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema3ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}
