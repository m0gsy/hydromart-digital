import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

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

  @ApiProperty({ example: 30, description: 'Days between services.' })
  @IsInt()
  @Min(1)
  intervalDays!: number;

  @ApiProperty({ format: 'date-time', description: 'When the item is next due for service.' })
  @IsISO8601()
  nextDueAt!: string;

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
