import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Jawa Barat' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province!: string;

  @ApiPropertyOptional({ example: '40111' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string;

  // Required: depot routing is done by distance, so an address with no pin cannot be
  // matched to a depot at all. Saving one silently produced an address that looked fine
  // in the list and then failed — or worse, routed anywhere — at checkout.
  @ApiProperty({ example: -6.9147, description: 'Map pin latitude; required for depot routing.' })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 107.6098, description: 'Map pin longitude; required for depot routing.' })
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

  @ApiPropertyOptional({ description: 'Make this the primary address.', example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** Patch: any subset of address fields (primary is changed via the dedicated endpoint). */
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
