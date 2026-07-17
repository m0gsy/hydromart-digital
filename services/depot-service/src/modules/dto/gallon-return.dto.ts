import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { GallonCondition } from '../../domain/gallon-return';

export class CreateGallonReturnDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Customer who returned the empties (omit for walk-ins).' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ example: 3, description: 'Number of empty gallons handed back.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ enum: GallonCondition, default: GallonCondition.GOOD })
  @IsOptional()
  @IsEnum(GallonCondition)
  condition?: GallonCondition;

  @ApiPropertyOptional({ example: 15000, default: 0, description: 'Deposit refunded in IDR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  depositRefunded?: number;

  @ApiPropertyOptional({ example: 'Galon retak, tidak dipakai ulang' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Courier handover return (design 2e). No deposit field — it is derived server-side. */
export class CreateCourierReturnDto {
  @ApiProperty({ format: 'uuid', description: "Depot the courier's delivery belongs to." })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ format: 'uuid', description: 'Order the empties were collected against.' })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customer returning the empties.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ example: 2, description: 'Number of empty gallons handed back.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ enum: GallonCondition, default: GallonCondition.GOOD })
  @IsOptional()
  @IsEnum(GallonCondition)
  condition?: GallonCondition;

  @ApiPropertyOptional({ example: 'Galon retak' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ListReturnsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
