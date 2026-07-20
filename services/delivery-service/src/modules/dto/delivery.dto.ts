import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { DeliveryStatus } from '../../domain/delivery-status';
import { ContactMethod } from '../../domain/no-show';

export class ReportLocationDto {
  @ApiProperty({ example: -6.2088, description: "Driver's current latitude." })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 106.8456, description: "Driver's current longitude." })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

/** One order line, snapshotted onto the delivery for the courier manifest. */
export class DeliveryItemDto {
  @ApiProperty({ example: 'Galon Le Minerale 19L' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;
}

export class AssignDeliveryDto {
  @ApiProperty({ format: 'uuid', description: 'Order to deliver.' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'HM-20260710-000123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  orderNumber!: string;

  @ApiProperty({ format: 'uuid', description: 'Driver to assign.' })
  @IsUUID()
  driverId!: string;

  @ApiPropertyOptional({ example: 'Budi', description: 'Courier display name, snapshotted onto the order.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  driverName?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "Depot the order was routed to; snapshotted for per-franchise SLA.",
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiProperty({ example: 'Jl. Merdeka No. 10, Bandung' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  destinationAddress!: string;

  @ApiPropertyOptional({ example: -6.9147 })
  @IsOptional()
  @IsLatitude()
  destinationLat?: number;

  @ApiPropertyOptional({ example: 107.6098 })
  @IsOptional()
  @IsLongitude()
  destinationLng?: number;

  @ApiPropertyOptional({
    example: '081234567890',
    description: "Recipient's phone, snapshotted so the courier can call without a cross-service lookup.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  recipientPhone?: string;

  @ApiPropertyOptional({ type: [DeliveryItemDto], description: 'Order line-items ({name, qty}) for the courier manifest.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemDto)
  items?: DeliveryItemDto[];

  @ApiPropertyOptional({ example: 84000, description: 'Whole-IDR cash to collect on delivery; null/0 = non-COD.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  codAmount?: number;
}

/** Proof of delivery — all fields mandatory except the note (BR: photo+GPS+timestamp+signature). */
export class ProofOfDeliveryDto {
  @ApiProperty({ description: 'URL of the delivery photo.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  @ApiProperty({ description: 'URL of the captured recipient signature.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  signatureUrl!: string;

  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: -6.9147 })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 107.6098 })
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ example: 'Diterima langsung oleh pelanggan.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class FailDeliveryDto {
  @ApiProperty({ example: 'Alamat tidak ditemukan.', description: 'Reason the delivery failed.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}

export class RecordContactAttemptDto {
  @ApiPropertyOptional({ enum: ContactMethod, default: ContactMethod.CALL })
  @IsOptional()
  @IsEnum(ContactMethod)
  method?: ContactMethod;

  @ApiPropertyOptional({ example: 'Tidak diangkat.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class RescheduleDeliveryDto {
  @ApiProperty({ format: 'date-time', description: 'New target delivery time agreed with the customer.' })
  @IsDateString()
  rescheduledFor!: string;

  @ApiPropertyOptional({ example: 'Sore (15:00–18:00)', description: 'Human-readable slot label.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  slot?: string;

  @ApiPropertyOptional({ example: 'Pelanggan minta diantar ulang besok.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ListDeliveriesQueryDto {
  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter to one depot (HQ/finance/marketing only; depot-locked roles are forced to their own depot).',
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;

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
}
