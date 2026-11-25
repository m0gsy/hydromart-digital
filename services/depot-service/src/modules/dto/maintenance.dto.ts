import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Max,
} from 'class-validator';
import { INT4_MAX } from '@hydromart/platform';

/** numeric(12,3) holds 999,999,999.999. */
const MAX_M3 = 999_999_999;

export class CreateMaintenanceDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the equipment belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: 'Motor pengiriman B 1234 XYZ' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'Kendaraan' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category!: string;

  @ApiPropertyOptional({ example: 30, description: 'Days between services. Give this, intervalM3, or both: due is whichever comes first.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  intervalDays?: number;

  @ApiPropertyOptional({ example: 500, description: 'Cubic metres of water through the depot meter between services.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(MAX_M3)
  intervalM3?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'When the item is next due for service by days. Default: the last service (or now) plus intervalDays.' })
  @IsOptional()
  @IsISO8601()
  nextDueAt?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'When it was last serviced.' })
  @IsOptional()
  @IsISO8601()
  lastServicedAt?: string;

  @ApiPropertyOptional({ example: 'Ganti oli + cek rem' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListMaintenanceQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list maintenance items for.' })
  @IsUUID()
  depotId!: string;
}
