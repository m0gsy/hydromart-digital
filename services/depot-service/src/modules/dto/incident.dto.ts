import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import { IncidentSeverity, IncidentStatus, IncidentType } from '../../domain/incident';

export class CreateIncidentDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the incident occurred at.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ enum: IncidentType })
  @IsEnum(IncidentType)
  type!: IncidentType;

  @ApiProperty({ enum: IncidentSeverity })
  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;

  @ApiProperty({ example: 'Galon bocor / rusak' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ example: '1 galon retak saat pengangkutan' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'Budi', description: 'Courier involved, if any.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;

  @ApiPropertyOptional({ example: 'HM-...000476', description: 'Related order reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  orderRef?: string;
}

export class ListIncidentQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list incidents for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: IncidentStatus })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;
}

export class ResolveIncidentDto {
  @ApiProperty({ example: 'Ditangani manajer, pelanggan sudah dihubungi' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}
