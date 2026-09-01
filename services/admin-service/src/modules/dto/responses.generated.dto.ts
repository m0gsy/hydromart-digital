// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class ListResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors `PurgeResultEntry` exactly — generated for audit D-6, no field added or removed. */
export class PurgeResultEntryResponseDto {
  @ApiProperty({ type: String })
  dataset!: string;
  @ApiProperty({ enum: ['FINANCIAL', 'OPERATIONAL', 'HR', 'MARKETING'] })
  dataClass!: string;
  @ApiProperty({ type: Object })
  outcome!: unknown;
  @ApiProperty({ type: String, nullable: true })
  cutoff!: string | null;
  @ApiProperty({ type: Number })
  deleted!: number;
  @ApiProperty({ required: false, type: Number })
  eligible?: number;
  @ApiProperty({ required: false, type: String })
  error?: string;
}

/** Mirrors `PurgeRunResult` exactly — generated for audit D-6, no field added or removed. */
export class PurgeRunResponseDto {
  @ApiProperty({ type: String })
  ranAt!: string;
  @ApiProperty({ type: Boolean })
  dryRun!: boolean;
  @ApiProperty({ type: [PurgeResultEntryResponseDto] })
  entries!: PurgeResultEntryResponseDto[];
  @ApiProperty({ type: Number })
  totalDeleted!: number;
  @ApiProperty({ type: [String] })
  unenforced!: string[];
  @ApiProperty({ type: [String] })
  awaitingReview!: string[];
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List2ResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class List3ResponseDto {
  @ApiProperty({ type: [Object] })
  items!: unknown[];
  @ApiProperty({ type: Number })
  total!: number;
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  limit!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PdpErasedResponseDto {
  @ApiProperty({ type: Number })
  erased!: number;
}
