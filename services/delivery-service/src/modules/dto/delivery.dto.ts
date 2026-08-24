import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

  /**
   * The customer this order belongs to, snapshotted so a delivery notification can thread
   * into their in-app feed rather than only reaching their phone. Optional: a counter sale
   * has no account behind it, and every binary already in Play sends this payload without
   * the field.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    example: '081298765432',
    description: "Courier's phone, forwarded to order-service so the customer can call the driver.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  driverPhone?: string;

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

  @ApiPropertyOptional({
    example: 'Pagar hijau sebelah warung Bu Ani, gang masuk 50m.',
    description: 'Delivery note / landmark (patokan) snapshotted from the order for the courier.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;

  // B5: the window the customer picked at checkout, snapshotted for the courier the same
  // way the landmark is. Free-form client label, not a slot the server allocates.
  @ApiPropertyOptional({
    example: '2026-08-22 09:00-12:00',
    description: 'Delivery time-window chosen by the customer, snapshotted from the order.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryWindow?: string;
}

/** Proof of delivery — photo + GPS + timestamp mandatory; signature + note optional. */
export class ProofOfDeliveryDto {
  @ApiProperty({ description: 'URL of the delivery photo.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  @ApiPropertyOptional({ description: 'URL of the captured recipient signature (optional).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  signatureUrl?: string;

  @ApiPropertyOptional({
    description:
      'Did the courier confirm the gallon seal was intact? Omit it and the answer stays null — never asked is not the same as yes.',
  })
  @IsOptional()
  @IsBoolean()
  sealIntact?: boolean;

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

  @ApiPropertyOptional({
    example: '2026-07-29T08:15:00.000Z',
    description: 'Device time for proof queued offline. Clamped to [assignedAt, now]; omit when live.',
  })
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
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
  @ApiPropertyOptional({
    description:
      'Keyset cursor from the previous response (`nextCursor`). Reads the next page ' +
      'without an OFFSET; `page` is ignored when this is given.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

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

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
