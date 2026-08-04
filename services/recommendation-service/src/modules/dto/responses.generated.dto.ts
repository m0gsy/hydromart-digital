// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class IngestResponseDto {
  @ApiProperty({ enum: [true] })
  ingested!: true;
}

/** Mirrors `RecItem` exactly — generated for audit D-6, no field added or removed. */
export class RecItemResponseDto {
  @ApiProperty({ type: String })
  productId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  sku!: string;
  @ApiProperty({ type: String })
  unit!: string;
  @ApiProperty({ type: Number })
  score!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RebuildNowResponseDto {
  @ApiProperty({ type: Number })
  ingested!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Ingest2ResponseDto {
  @ApiProperty({ enum: [true] })
  ingested!: true;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RebuildNow2ResponseDto {
  @ApiProperty({ type: Number })
  ingested!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Ingest3ResponseDto {
  @ApiProperty({ enum: [true] })
  ingested!: true;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class RebuildNow3ResponseDto {
  @ApiProperty({ type: Number })
  ingested!: number;
}
