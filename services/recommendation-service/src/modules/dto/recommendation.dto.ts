import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

/* ---------- Query DTOs ---------- */

export class LimitQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, description: 'Max number of items to return.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

export class TrendingQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one depot; omit for all depots.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ default: 7, minimum: 1, description: 'Trending window, in days.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  days?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, description: 'Max number of items to return.' })
  @IsOptional()
  @IsInt()
  @Min(1)
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
}

export class IngestOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

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
