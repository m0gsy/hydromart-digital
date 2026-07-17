import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { InventoryItemType } from '../../domain/inventory';
import { PoStatus } from '../../domain/purchase-order';

export class CreateSupplierDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the supplier serves.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: 'Tirta Makmur' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'SUP-01' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @ApiPropertyOptional({ example: '081234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @ApiPropertyOptional({ type: [String], example: ['Galon 19L', 'Segel', 'Air baku'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({ example: 0.95, description: 'On-time delivery rate 0..1.' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  onTimeRate?: number;
}

export class SupplierQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list suppliers for.' })
  @IsUUID()
  depotId!: string;
}

export class PoLineDto {
  @ApiProperty({ enum: InventoryItemType })
  @IsEnum(InventoryItemType)
  itemType!: InventoryItemType;

  @ApiProperty({ example: 'Galon 19L' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 18000, description: 'Unit cost in whole IDR.' })
  @IsInt()
  @Min(0)
  unitCostIdr!: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ format: 'uuid', description: 'Depot placing the order.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ type: [PoLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines!: PoLineDto[];

  @ApiPropertyOptional({ example: 25000, description: 'Shipping cost in whole IDR.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  shippingIdr?: number;

  @ApiPropertyOptional({ example: '2026-07-25', description: 'Expected delivery date.' })
  @IsOptional()
  @IsISO8601()
  expectedAt?: string;
}

export class PurchaseOrderQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list purchase orders for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: PoStatus })
  @IsOptional()
  @IsEnum(PoStatus)
  status?: PoStatus;
}
