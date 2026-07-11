import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';

import { DeliveryStatus } from '../../domain/delivery-status';

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

export class ListDeliveriesQueryDto {
  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

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
