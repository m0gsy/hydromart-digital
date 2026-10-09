import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { DepotAssignmentKind, DepotAssignmentStatus } from '../../../prisma/generated/client';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class PlanDepotAssignmentDto {
  @IsUUID() employeeId!: string;
  @IsEnum(DepotAssignmentKind) kind!: DepotAssignmentKind;
  /** The depot they are sent TO. */
  @IsUUID() depotId!: string;
  @Matches(DAY, { message: 'startDate harus format YYYY-MM-DD' }) startDate!: string;
  /** Inclusive last day. Required for a LOAN; omit for a PERMANENT move. */
  @IsOptional() @Matches(DAY, { message: 'endDate harus format YYYY-MM-DD' }) endDate?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ListDepotAssignmentDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsEnum(DepotAssignmentStatus) status?: DepotAssignmentStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20;
}

/** What the routes return - mirrors `EmployeeDepotAssignment`, no field added or removed. */
export class DepotAssignmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty({ enum: DepotAssignmentKind }) kind!: DepotAssignmentKind;
  @ApiProperty() depotId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startDate!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) endDate!: Date | null;
  @ApiProperty({ enum: DepotAssignmentStatus }) status!: DepotAssignmentStatus;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) appliedStartAt!: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) appliedEndAt!: Date | null;
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ nullable: true }) failReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) createdByRole!: string | null;
  @ApiPropertyOptional({ nullable: true }) createdBy!: string | null;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class PagedDepotAssignmentResponseDto {
  @ApiProperty({ type: [DepotAssignmentResponseDto] }) rows!: DepotAssignmentResponseDto[];
  @ApiProperty() total!: number;
}
