import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

export class ApproveDataSubjectRequestDto {
  @ApiPropertyOptional({
    description:
      'Erase even though the customer has open orders. Only a SUPER_ADMIN may set it; anyone else gets 403.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
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
  /**
   * §G-3: the account name behind `customerId`, so the queue does not ask HQ to decide a
   * deletion against eight hex characters. Only the staff queue fills it — a customer
   * reading their own requests already knows who they are.
   */
  @ApiProperty({ type: String, nullable: true }) customerName!: string | null;

  static from(
    record: DataSubjectRequestRecord & { customerName?: string | null },
  ): DataSubjectRequestDto {
    return {
      customerName: record.customerName ?? null,
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
