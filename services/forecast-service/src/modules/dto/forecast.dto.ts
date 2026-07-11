import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

/* ---------- Query DTOs ---------- */

// historyDays/horizonDays are ALSO clamped in the service (defence in depth); the @Max here
// just rejects absurd input at the edge, matching the sibling defensive style.

export class DemandQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Product to forecast.' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one depot; omit for a global (all-depot) forecast.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ default: 30, minimum: 7, maximum: 365, description: 'History window, in days.' })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  @Type(() => Number)
  historyDays?: number;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90, description: 'Forecast horizon, in days.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  horizonDays?: number;
}

export class DepotRollupQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 7, maximum: 365, description: 'History window, in days.' })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  @Type(() => Number)
  historyDays?: number;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90, description: 'Forecast horizon, in days.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  horizonDays?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Max products to return.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class RebuildQueryDto {
  @ApiPropertyOptional({ default: 100, minimum: 1, description: 'Max orders to pull per feed page.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

/* ---------- Ingest body ---------- */

export class IngestItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsString()
  productName!: string;

  @ApiProperty()
  @IsString()
  sku!: string;

  @ApiProperty()
  @IsString()
  unit!: string;

  @ApiProperty({ minimum: 1, description: 'Units sold (forecast aggregates units, not just order count).' })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class IngestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Null/omitted when the order has no depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string | null;

  @ApiProperty({ type: [IngestItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngestItemDto)
  items!: IngestItemDto[];
}
