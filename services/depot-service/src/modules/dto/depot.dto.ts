import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { OwnershipType } from '../../domain/inventory';

export class BrowseDepotsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: OwnershipType })
  @IsOptional()
  @IsEnum(OwnershipType)
  ownershipType?: OwnershipType;

  @ApiPropertyOptional({ description: 'Search by depot name, code, or city.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class NearbyDepotsQueryDto {
  @ApiProperty({ example: -6.1944, description: 'Caller latitude.' })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 106.8412, description: 'Caller longitude.' })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateDepotDto {
  @ApiProperty({ example: 'JKT-01' })
  @IsString()
  @MaxLength(30)
  code!: string;

  @ApiProperty({ example: 'Depot Cikini' })
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: OwnershipType })
  @IsEnum(OwnershipType)
  ownershipType!: OwnershipType;

  @ApiProperty({ example: 'Jl. Cikini Raya No. 1' })
  @IsString()
  @MaxLength(300)
  address!: string;

  @ApiProperty({ example: 'Jakarta Pusat' })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'DKI Jakarta' })
  @IsString()
  @MaxLength(100)
  province!: string;

  @ApiProperty({ example: -6.1944 })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 106.8412 })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ example: 5, description: 'Service/delivery radius in km.' })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  serviceRadiusKm?: number;

  @ApiProperty({ example: 5000, description: 'Flat delivery fee in IDR.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee!: number;

  @ApiPropertyOptional({ example: 20000, description: 'Minimum order amount in IDR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({ description: 'Franchise owner (account id) who manages this depot.' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: "Depot's bank name for direct payment.", example: 'BCA' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentBankName?: string;

  @ApiPropertyOptional({ description: "Depot's bank account number.", example: '1234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentBankAccountNumber?: string;

  @ApiPropertyOptional({ description: "Depot's bank account holder name." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentBankAccountHolder?: string;

  @ApiPropertyOptional({ description: "URL of the depot's static QRIS image." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentQrisImageUrl?: string;

  // ponytail: JSON blobs validated shallowly (shape documented in schema.prisma); tighten to
  // nested DTOs if operators start submitting malformed hours/holidays.
  @ApiPropertyOptional({
    description: 'Weekly hours, e.g. { "mon": { "open": "08:00", "close": "20:00" } }.',
  })
  @IsOptional()
  @IsObject()
  operatingHours?: Record<string, { open: string; close: string }>;

  @ApiPropertyOptional({ description: 'Closure dates, e.g. [{ "date": "2026-08-17" }].' })
  @IsOptional()
  @IsArray()
  holidays?: { date: string; label?: string }[];
}

export class UpdateDepotDto extends PartialType(CreateDepotDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
