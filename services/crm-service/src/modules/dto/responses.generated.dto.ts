// GENERATED (audit D-6) — mirrors of the shapes these routes already return.
// Regenerate rather than hand-edit: the point is that the documented schema cannot
// drift from the response. No field is added, removed or renamed here.
import { ApiProperty } from '@nestjs/swagger';

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PurgeResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class VapidPublicKeyResponseDto {
  @ApiProperty({ type: String })
  key!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Purge2ResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class VapidPublicKey2ResponseDto {
  @ApiProperty({ type: String })
  key!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class Purge3ResponseDto {
  @ApiProperty({ type: Number })
  deleted!: number;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class VapidPublicKey3ResponseDto {
  @ApiProperty({ type: String })
  key!: string;
}

/** Mirrors the inline response shape this route already returns (audit D-6). */
export class PdpErasedResponseDto {
  @ApiProperty({ type: Number })
  erased!: number;
}
