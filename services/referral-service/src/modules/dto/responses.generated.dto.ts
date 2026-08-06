// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors `ReferralRecord` exactly — generated for audit D-6, no field added or removed. */
export class ReferralResponseDto {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  referrerCustomerId!: string;
  @ApiProperty({ type: String })
  refereeCustomerId!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ enum: ['PENDING', 'QUALIFIED'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  qualifyingOrderId!: string | null;
  @ApiProperty({ type: Number })
  referrerPoints!: number;
  @ApiProperty({ type: Number })
  refereePoints!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  qualifiedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Mirrors `QualifyResult` exactly — generated for audit D-6, no field added or removed. */
export class QualifyResponseDto {
  @ApiProperty({ type: Boolean })
  qualified!: boolean;
  @ApiProperty({ required: false, type: ReferralResponseDto })
  referral?: ReferralResponseDto;
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

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema2ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Schema3ResponseDto {
  @ApiProperty({ type: [SettingDefResponseDto] })
  defs!: SettingDefResponseDto[];
  @ApiProperty({ type: Object })
  effective!: unknown;
}
