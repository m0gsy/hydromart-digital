import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { InventoryItemType, StockMovementType } from '../../domain/inventory';

export class ListInventoryQueryDto {
  @ApiPropertyOptional({ enum: InventoryItemType })
  @IsOptional()
  @IsEnum(InventoryItemType)
  itemType?: InventoryItemType;

  @ApiPropertyOptional({ description: 'Only lines at or below their minimum stock.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStockOnly?: boolean;
}

export class ListStockMovementsQueryDto {
  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class WastageQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to summarize wastage for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive upper bound (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class CreateInventoryItemDto {
  @ApiProperty({ enum: InventoryItemType })
  @IsEnum(InventoryItemType)
  itemType!: InventoryItemType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for PRODUK lines only.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ example: 'Galon 19L' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label!: string;

  @ApiProperty({ example: 'unit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit!: string;

  @ApiPropertyOptional({ example: 100, default: 0, description: 'Opening quantity.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 20, default: 0, description: 'Low-stock threshold (0 = off).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumStock?: number;

  @ApiPropertyOptional({
    example: 22000,
    description: 'Per-depot sell price override in IDR (PRODUK lines); omit to use catalog price.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;
}

export class UpdateInventoryItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional({ description: 'Low-stock threshold (0 = off).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumStock?: number;

  @ApiPropertyOptional({
    example: 22000,
    description: 'Per-depot sell price override in IDR (PRODUK lines); set null to clear.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;
}

export class AdjustStockDto {
  @ApiProperty({ example: -5, description: 'Signed change; negative consumes stock.' })
  @Type(() => Number)
  @IsInt()
  delta!: number;

  @ApiPropertyOptional({ example: 'Damaged gallons removed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ConsumeLineDto {
  @ApiProperty({ format: 'uuid', description: 'Catalog product sold.' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 2, description: 'Quantity sold.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class ConsumeStockDto {
  @ApiProperty({ format: 'uuid', description: 'The completing order (recorded on each movement).' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ type: [ConsumeLineDto], description: 'Sold products to deduct.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConsumeLineDto)
  items!: ConsumeLineDto[];
}

export class OpnameStockDto {
  @ApiProperty({ example: 95, description: 'Physically counted quantity.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @ApiPropertyOptional({ example: 'Monthly stock opname' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
