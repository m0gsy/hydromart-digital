// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `PromotionRecord` exactly — generated for audit D-6, no field added or removed. */
export class PromotionResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  subtitle!: string | null;
  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  ctaLabel!: string | null;
  @ApiProperty({ type: String, nullable: true })
  ctaHref!: string | null;
  @ApiProperty({ type: String, nullable: true })
  voucherCode!: string | null;
  @ApiProperty({ type: Number })
  sortOrder!: number;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `VoucherRequestRecord` exactly — generated for audit D-6, no field added or removed. */
export class VoucherRequestResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: String })
  depotName!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED', 'FREE_SHIPPING'] })
  discountType!: string;
  @ApiProperty({ type: Number })
  value!: number;
  @ApiProperty({ type: Number })
  minSpend!: number;
  @ApiProperty({ type: Number, nullable: true })
  maxDiscount!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  usageLimit!: number | null;
  @ApiProperty({ type: Number })
  perCustomerLimit!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  status!: string;
  @ApiProperty({ type: String })
  requestedBy!: string;
  /** §G-3: denormalised from auth-service so HQ sees who is asking. */
  @ApiProperty({ type: String, nullable: true })
  requestedByName!: string | null;
  @ApiProperty({ type: String, nullable: true })
  decidedBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  createdVoucherId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class BurnSummaryResponseDto {
  @ApiProperty({ type: Number })
  totalUsed!: number;
  @ApiProperty({ type: Object })
  byVoucher!: unknown;
}

/** Mirrors `QuoteResult` exactly — generated for audit D-6, no field added or removed. */
export class QuoteResponseDto {
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED', 'FREE_SHIPPING'] })
  discountType!: string;
  @ApiProperty({ type: Number })
  discount!: number;
  @ApiProperty({ enum: [true] })
  valid!: true;
}

/** Mirrors `RedeemResult` exactly — generated for audit D-6, no field added or removed. */
export class RedeemResponseDto {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: Number })
  discountApplied!: number;
}

/** Mirrors `VoucherRecord` exactly — generated for audit D-6, no field added or removed. */
export class VoucherResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED', 'FREE_SHIPPING'] })
  discountType!: string;
  @ApiProperty({ type: Number })
  value!: number;
  @ApiProperty({ type: Number })
  minSpend!: number;
  @ApiProperty({ type: Number, nullable: true })
  maxDiscount!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validFrom!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validUntil!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  usageLimit!: number | null;
  @ApiProperty({ type: Number })
  perCustomerLimit!: number;
  @ApiProperty({ type: Number, nullable: true })
  budgetCap!: number | null;
  @ApiProperty({ type: Number })
  usedCount!: number;
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class GrantResponseDto {
  @ApiProperty({ type: VoucherResponseDto })
  voucher!: VoucherResponseDto;
  @ApiProperty({ type: Boolean })
  granted!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class BurnSummary2ResponseDto {
  @ApiProperty({ type: Number })
  totalUsed!: number;
  @ApiProperty({ type: Object })
  byVoucher!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Grant2ResponseDto {
  @ApiProperty({ type: VoucherResponseDto })
  voucher!: VoucherResponseDto;
  @ApiProperty({ type: Boolean })
  granted!: boolean;
}

/** Mirrors `Page<VoucherRequestRecord>` — the paged envelope this route already returns. */
export class PagedVoucherRequestResponseDto {
  @ApiProperty({ type: [VoucherRequestResponseDto] })
  items!: VoucherRequestResponseDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `Page<VoucherRecord>` — the paged envelope this route already returns. */
export class PagedVoucherResponseDto {
  @ApiProperty({ type: [VoucherResponseDto] })
  items!: VoucherResponseDto[];
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
export class BurnSummary3ResponseDto {
  @ApiProperty({ type: Number })
  totalUsed!: number;
  @ApiProperty({ type: Object })
  byVoucher!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Grant3ResponseDto {
  @ApiProperty({ type: VoucherResponseDto })
  voucher!: VoucherResponseDto;
  @ApiProperty({ type: Boolean })
  granted!: boolean;
}
