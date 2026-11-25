import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { INT4_MAX } from '@hydromart/platform';

/** What one new version says. `body` and/or `fileKey`; all depots, or a list, never both. */
export class SopVersionDto {
  /** Heading of this wording; defaults to the SOP's own title. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) versionTitle?: string;
  @IsOptional() @IsString() @MaxLength(50_000) body?: string;
  /** The key POST /sops/uploads returned. Matched again server-side before it is stored. */
  @IsOptional() @IsString() @MaxLength(100) fileKey?: string;
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;
  @IsOptional() @IsInt() @Min(0) @Max(INT4_MAX) sizeBytes?: number;
  /** WIB day, YYYY-MM-DD, not before today. */
  @Matches(new RegExp('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) effectiveFrom!: string;
  @IsBoolean() allDepots!: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) depotIds?: string[];
}

export class CreateSopDto extends SopVersionDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
}

export class UnreadSopDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class InForceQueryDto {
  @IsUUID() depotId!: string;
  /** Comma separated SOP ids, at most 60. */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsUUID('all', { each: true })
  ids!: string[];
}

// Response shapes, declared so the OpenAPI document says what the routes return (audit D-6).
export class SopUploadResponseDto {
  @ApiProperty() fileKey!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() sizeBytes!: number;
}
export class SopSummaryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() versionCount!: number;
  @ApiProperty({ type: Object, nullable: true }) current!: unknown;
  @ApiProperty({ type: Object, nullable: true }) upcoming!: unknown;
}
export class SopDetailResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [Object] }) versions!: unknown[];
}
export class SopUnreadResponseDto {
  @ApiProperty() versionId!: string;
  @ApiProperty() unreadTotal!: number;
  @ApiProperty({ type: [Object] }) byDepot!: unknown[];
  @ApiProperty({ type: [Object] }) items!: unknown[];
}
export class SopInForceResponseDto {
  @ApiProperty({ type: [Object] }) items!: unknown[];
}
export class SopMineResponseDto {
  @ApiProperty() sopId!: string;
  @ApiProperty() versionId!: string;
  @ApiProperty() versionNo!: number;
  @ApiProperty() acked!: boolean;
}
export class SopAckResponseDto {
  @ApiProperty() ackedAt!: Date;
}
