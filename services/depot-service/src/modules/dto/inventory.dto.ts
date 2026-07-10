import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

import { InventoryItemType } from '../../domain/inventory';

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
