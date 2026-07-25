import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class RegisterResellerDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty() @IsUUID() homeDepotId!: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) monthlyTargetQty!: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Flat reseller discount percent off subtotal.' })
  @IsOptional() @IsInt() @Min(0) @Max(100) discountPct?: number;
  @ApiProperty({ example: '2026-01-01' }) @IsISO8601() joinDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateResellerDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() homeDepotId?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) monthlyTargetQty?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100) discountPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ListResellerQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() depotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
