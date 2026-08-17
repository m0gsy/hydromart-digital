// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `ForecastResult` exactly — generated for audit D-6, no field added or removed. */
export class ForecastResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;
  @ApiProperty({ type: String, nullable: true })
  unit!: string | null;
  @ApiProperty({ type: Number })
  avgDaily!: number;
  @ApiProperty({ type: Number })
  trendSlope!: number;
  @ApiProperty({ type: [Number] })
  predictedDaily!: number[];
  @ApiProperty({ type: Number })
  predictedTotal!: number;
  @ApiProperty({ type: Number })
  reorderSuggestion!: number;
  @ApiProperty({ type: Number })
  confidence!: number;
  @ApiProperty({ type: [Number] })
  history!: number[];
}

/** Mirrors `ForecastItem` exactly — generated for audit D-6, no field added or removed. */
export class ForecastItemResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true })
  sku!: string | null;
  @ApiProperty({ type: String, nullable: true })
  unit!: string | null;
  @ApiProperty({ type: Number })
  avgDaily!: number;
  @ApiProperty({ type: Number })
  trendSlope!: number;
  @ApiProperty({ type: Number })
  predictedTotal!: number;
  @ApiProperty({ type: Number })
  reorderSuggestion!: number;
}

/** Mirrors `SalesForecast` exactly — generated for audit D-6, no field added or removed. */
export class SalesForecastResponseDto {
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ type: Number })
  avgDaily!: number;
  @ApiProperty({ type: Number })
  trendSlope!: number;
  @ApiProperty({ type: [Number] })
  predictedDaily!: number[];
  @ApiProperty({ type: Number })
  predictedTotal!: number;
  @ApiProperty({ type: [Number] })
  history!: number[];
}

/** Mirrors `ChurnItem` exactly — generated for audit D-6, no field added or removed. */
export class ChurnItemResponseDto {
  @ApiProperty({ type: String })
  customerId!: string;
  /** §G-3: denormalised from auth-service so the list reads as people. */
  @ApiProperty({ type: String, nullable: true })
  customerName!: string | null;
  @ApiProperty({ type: String })
  lastOrderAt!: string;
  @ApiProperty({ type: Number })
  orderCount!: number;
  @ApiProperty({ type: Number })
  daysSince!: number;
  @ApiProperty({ type: Number })
  riskScore!: number;
  @ApiProperty({ type: Object })
  riskBand!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ChurnResponseDto {
  @ApiProperty({ type: [ChurnItemResponseDto] })
  customers!: ChurnItemResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RebuildNowResponseDto {
  @ApiProperty({ type: Number })
  ingested!: number;
  @ApiProperty({ type: Number })
  pages!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class IngestResponseDto {
  @ApiProperty({ enum: [true] })
  ingested!: true;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Churn2ResponseDto {
  @ApiProperty({ type: [ChurnItemResponseDto] })
  customers!: ChurnItemResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RebuildNow2ResponseDto {
  @ApiProperty({ type: Number })
  ingested!: number;
  @ApiProperty({ type: Number })
  pages!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Ingest2ResponseDto {
  @ApiProperty({ enum: [true] })
  ingested!: true;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Churn3ResponseDto {
  @ApiProperty({ type: [ChurnItemResponseDto] })
  customers!: ChurnItemResponseDto[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RebuildNow3ResponseDto {
  @ApiProperty({ type: Number })
  ingested!: number;
  @ApiProperty({ type: Number })
  pages!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Ingest3ResponseDto {
  @ApiProperty({ enum: [true] })
  ingested!: true;
}

/** PR-J settings slice: the same shape order-service already answers with (audit D-6). */
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
  @ApiProperty({ required: false, type: String })
  pattern?: string;
  @ApiProperty({ required: false, type: Boolean })
  global?: boolean;
}

export class SettingsSchemaResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}
