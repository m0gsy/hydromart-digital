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
  @ApiProperty({ type: String, nullable: true })
  productId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;
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

/** Mirrors `PromoRuleRecord` exactly. */
export class PromoRuleResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({
    type: String,
    enum: [
      'SPECIAL_PRICE',
      'BUY_X_GET_Y',
      'SHIPPING_DISCOUNT',
      'PERCENTAGE_OFF',
      'ORDER_DISCOUNT',
      'BUNDLE_GIFT',
    ],
  })
  kind!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  productId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  specialPrice!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  buyQty!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  getQty!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  shippingFeeOverride!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  percentOff!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  minSubtotal!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  discountAmount!: number | null;
  @ApiProperty({ type: String, nullable: true })
  giftProductId!: string | null;
  @ApiProperty({ type: Boolean })
  firstOrderOnly!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validFrom!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  validUntil!: Date | null;
  @ApiProperty({ type: [Number] })
  daysOfWeek!: number[];
  @ApiProperty({ type: String, nullable: true })
  startTime!: string | null;
  @ApiProperty({ type: String, nullable: true })
  endTime!: string | null;
  @ApiProperty({ type: Number })
  minQty!: number;
  @ApiProperty({ type: Number, nullable: true })
  maxQty!: number | null;
  @ApiProperty({ type: [String] })
  channels!: string[];
  @ApiProperty({ type: Boolean })
  active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** Mirrors `LineResult` exactly (src/domain/promo-rule.ts). */
export class PromoLineResultDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: [String] })
  appliedRuleIds!: string[];
  @ApiProperty({ type: Number })
  unitPriceAfter!: number;
  @ApiProperty({ type: Number })
  freeQty!: number;
  @ApiProperty({ type: Number })
  lineTotal!: number;
}

/** Mirrors `GiftResult` exactly (src/domain/promo-rule.ts). */
export class PromoGiftResultDto {
  @ApiProperty({ type: String })
  promoRuleId!: string;
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: String })
  triggerProductId!: string;
}

/** Mirrors `QuoteOutput` exactly (src/application/services/promo-rule.service.ts). */
export class AutoApplyQuoteResponseDto {
  @ApiProperty({ type: [PromoLineResultDto] })
  lines!: PromoLineResultDto[];
  @ApiProperty({ type: String, nullable: true })
  shippingAppliedRuleId!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  shippingFeeOverride!: number | null;
  @ApiProperty({ type: String, nullable: true })
  orderDiscountRuleId!: string | null;
  @ApiProperty({ type: Number, description: 'Rupiah off the order; 0 when none.' })
  orderDiscountAmount!: number;
  @ApiProperty({ type: [PromoGiftResultDto] })
  gifts!: PromoGiftResultDto[];
}
