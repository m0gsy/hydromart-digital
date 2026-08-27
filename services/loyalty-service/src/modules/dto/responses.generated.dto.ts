// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';
import { PointsTransactionDto } from './loyalty.dto';

/** Mirrors `TierBenefit` exactly — generated for audit D-6, no field added or removed. */
export class TierBenefitResponseDto {
  @ApiProperty({ enum: ['REGULAR', 'SILVER', 'GOLD', 'PLATINUM'] })
  tier!: string;
  @ApiProperty({ type: Number })
  threshold!: number;
  @ApiProperty({ type: Number })
  discountRate!: number;
}

/** Mirrors `Page<PointsTransactionDto>` — the paged envelope this route already returns. */
export class PagedPointsTransactionResponseDto {
  @ApiProperty({ type: [PointsTransactionDto] })
  items!: PointsTransactionDto[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
  @ApiProperty({ type: Number })
  totalPages!: number;
}

/** Mirrors `ExpiryResult` exactly — generated for audit D-6, no field added or removed. */
export class ExpiryResponseDto {
  @ApiProperty({ type: Number })
  lotsExpired!: number;
  @ApiProperty({ type: Number })
  pointsExpired!: number;
  @ApiProperty({ type: Boolean })
  disabled!: boolean;
}

/**
 * PAR-01: the scheduler's view of the same sweep. `ok` is what sweep.sh greps (J7) — a 200
 * is a statement about the transport, not about the round.
 */
export class ExpirySweepResponseDto extends ExpiryResponseDto {
  @ApiProperty({ type: Boolean })
  ok!: boolean;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class MemberCountResponseDto {
  @ApiProperty({ type: Number })
  count!: number;
}

/** Mirrors `DepotLoyaltySummary` exactly — generated for audit D-6, no field added or removed. */
export class DepotLoyaltyResponseDto {
  @ApiProperty({ type: String })
  depotId!: string;
  @ApiProperty({ type: Number })
  totalMembers!: number;
  @ApiProperty({ type: Number })
  pointsOutstanding!: number;
  @ApiProperty({ type: Number })
  redeemedThisMonth!: number;
  @ApiProperty({ type: Object })
  tiers!: unknown;
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
