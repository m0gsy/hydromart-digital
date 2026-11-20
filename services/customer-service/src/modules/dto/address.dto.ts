import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** "Bandung " and "Bandung" are one city: a stray space split campaign segments and reports. */
const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAddressDto {
  @ApiProperty({ example: 'Rumah' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label!: string;

  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '081234567890' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: 'Jl. Merdeka No. 10, RT 01/RW 02' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine!: string;

  @ApiProperty({ example: 'Bandung' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  /*
   * Optional since the form stopped asking. The column stays and old rows keep their value —
   * order snapshots print it and crm-service segments on the city beside it — so this accepts
   * a province when one is sent and never demands one.
   */
  @ApiPropertyOptional({ example: 'Jawa Barat' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @ApiPropertyOptional({ example: '40111' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  // Required: depot routing is done by distance, so an address with no pin cannot be
  // matched to a depot at all. Saving one silently produced an address that looked fine
  // in the list and then failed — or worse, routed anywhere — at checkout.
  @ApiProperty({ example: -6.9147, description: 'Map pin latitude; required for depot routing.' })
  // A NUMBER: IsLatitude alone also accepts "-6.9", which reached the Float column as a
  // string and came back as a 500.
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 107.6098, description: 'Map pin longitude; required for depot routing.' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({
    example: 'Pagar hijau sebelah warung Bu Ani, gang masuk 50m.',
    description: 'Landmark / patokan shown to the courier.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;

  /** 2026-11-20: how good the pin is, as the phone reported it (metres). */
  @ApiPropertyOptional({ example: 12, description: 'Pin accuracy in metres (GPS fixes).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  pinAccuracyM?: number;

  /** Where the customer's pin came from. STAFF / IMPORT / COURIER are set by the server only. */
  @ApiPropertyOptional({ enum: ['GPS', 'MANUAL'] })
  @IsOptional()
  @IsIn(['GPS', 'MANUAL'])
  pinSource?: 'GPS' | 'MANUAL';

  @ApiPropertyOptional({ description: 'Make this the primary address.', example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * Patch: any subset of the fields, and only those.
 *
 * Not `isPrimary`: this accepted it, so `{ isPrimary: false }` on the primary address left the
 * customer with none, and with no primary address they dropped out of every campaign and
 * voucher. The dedicated endpoint keeps exactly one.
 *
 * Not `null` either, except for the landmark: PartialType skipped validation on null, so
 * `{ city: null }` reached a NOT NULL column and answered 500.
 */
export class UpdateAddressDto extends PartialType(
  OmitType(CreateAddressDto, ['isPrimary', 'notes'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({ nullable: true, description: 'Landmark / patokan; null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string | null;
}
