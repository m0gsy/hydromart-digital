import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { IncidentSeverity, IncidentStatus } from '../../domain/incident';
import {
  IncidentRecord,
  IncidentUpdateRecord,
} from '../../application/ports/incident.repository';

/* ---------- Requests ---------- */

export class IncidentQueryDto {
  @ApiPropertyOptional({ enum: IncidentStatus })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;
}

export class CreateIncidentDto {
  @ApiProperty({ example: 'Elevated settlement latency' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: IncidentSeverity })
  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;

  @ApiProperty({ example: 'payment-service' })
  @IsString()
  @MaxLength(120)
  affectedService!: string;

  @ApiPropertyOptional({ description: 'Opening note for the incident.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Append a timeline note and/or move the incident's status (add update / resolve). */
export class PatchIncidentDto {
  @ApiPropertyOptional({ description: 'Timeline update text to append.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ enum: IncidentStatus })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;
}

/* ---------- Responses ---------- */

export class IncidentUpdateDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  note!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: IncidentUpdateRecord): IncidentUpdateDto {
    return { id: record.id, note: record.note, createdAt: record.createdAt.toISOString() };
  }
}

export class IncidentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty({ enum: IncidentSeverity })
  severity!: IncidentSeverity;
  @ApiProperty()
  affectedService!: string;
  @ApiProperty({ enum: IncidentStatus })
  status!: IncidentStatus;
  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
  @ApiProperty({ nullable: true })
  note!: string | null;
  @ApiProperty({ type: [IncidentUpdateDto] })
  updates!: IncidentUpdateDto[];

  static from(record: IncidentRecord): IncidentDto {
    return {
      id: record.id,
      title: record.title,
      severity: record.severity,
      affectedService: record.affectedService,
      status: record.status,
      startedAt: record.startedAt.toISOString(),
      resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
      note: record.note,
      updates: record.updates.map(IncidentUpdateDto.from),
    };
  }
}
