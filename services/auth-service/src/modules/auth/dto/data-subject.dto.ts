import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  DATA_SUBJECT_REQUEST_TYPES,
  DataSubjectRequestRecord,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
} from '../../../domain/data-subject/data-subject-request';

export class CreateDataSubjectRequestDto {
  @ApiProperty({ enum: DATA_SUBJECT_REQUEST_TYPES })
  @IsIn(DATA_SUBJECT_REQUEST_TYPES)
  type!: DataSubjectRequestType;

  @ApiPropertyOptional({ description: 'Optional note from the customer.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectDataSubjectRequestDto {
  @ApiProperty({ description: 'Shown to the customer — a refusal without one explains nothing.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class DataSubjectRequestDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ enum: DATA_SUBJECT_REQUEST_TYPES }) type!: DataSubjectRequestType;
  @ApiProperty({ enum: ['PENDING', 'COMPLETED', 'REJECTED'] }) status!: DataSubjectRequestStatus;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) processedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) processedAt!: string | null;

  static from(record: DataSubjectRequestRecord): DataSubjectRequestDto {
    return {
      id: record.id,
      customerId: record.customerId,
      type: record.type,
      status: record.status,
      reason: record.reason,
      requestedAt: record.requestedAt.toISOString(),
      processedBy: record.processedBy,
      processedAt: record.processedAt ? record.processedAt.toISOString() : null,
    };
  }
}
