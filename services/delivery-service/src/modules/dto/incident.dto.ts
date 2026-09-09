import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IncidentCategory, IncidentSeverity } from '../../domain/incident';
import { IncidentRecord } from '../../application/ports/incident.repository';

/** CA-4-48: the depot whose couriers' incidents to list. Omitted = the caller's own scope. */
export class ListDepotIncidentsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

export class ReportIncidentDto {
  @ApiProperty({ enum: IncidentCategory })
  @IsEnum(IncidentCategory)
  category!: IncidentCategory;

  @ApiProperty({ enum: IncidentSeverity })
  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;

  @ApiProperty({ example: 'Ban bocor di Jl. Kemang, kendaraan tidak bisa jalan.' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Delivery this incident happened during.' })
  @IsOptional()
  @IsUUID()
  deliveryId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Depot the courier is assigned to.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ description: 'Photo URL from the PoD upload endpoint.' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  photoUrl?: string;

  @ApiPropertyOptional({ example: -6.9147 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 107.6098 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class IncidentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  /**
   * CA-4-48: WHO reported it. The courier's own history left this out because they know
   * who they are; the depot's review list is exactly the reader who does not.
   */
  @ApiProperty({ format: 'uuid' })
  driverId!: string;
  @ApiProperty({ nullable: true, format: 'uuid' })
  deliveryId!: string | null;
  @ApiProperty({ enum: IncidentCategory })
  category!: IncidentCategory;
  @ApiProperty({ enum: IncidentSeverity })
  severity!: IncidentSeverity;
  @ApiProperty()
  description!: string;
  @ApiProperty({ nullable: true })
  photoUrl!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(record: IncidentRecord): IncidentDto {
    return {
      id: record.id,
      driverId: record.driverId,
      deliveryId: record.deliveryId,
      category: record.category,
      severity: record.severity,
      description: record.description,
      photoUrl: record.photoUrl,
      createdAt: record.createdAt,
    };
  }
}
