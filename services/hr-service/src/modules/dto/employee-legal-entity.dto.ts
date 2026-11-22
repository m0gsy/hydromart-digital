import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsUUID, Matches } from 'class-validator';

export class AssignEmployeeLegalEntityDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  employeeIds!: string[];

  @ApiProperty({ format: 'uuid', description: 'A legal entity in depot-service.' })
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ example: '2026-12-01', description: 'The calendar day they start working for it.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  effectiveFrom!: string;
}

// ---- Responses ----

export class EmployeeLegalEntityPointResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;
  @ApiProperty({ format: 'uuid' })
  legalEntityId!: string;
  @ApiProperty({ example: '2026-12-01' })
  effectiveFrom!: string;
  @ApiProperty({ type: String, nullable: true })
  recordedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: Date;
}

export class EmployeeLegalEntityHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;
  @ApiProperty()
  employeeCode!: string;
  @ApiProperty()
  fullName!: string;
  @ApiProperty()
  position!: string;
  @ApiProperty({ type: String, nullable: true })
  depotId!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'RESIGNED'] })
  status!: string;
  @ApiProperty({ type: [EmployeeLegalEntityPointResponseDto], description: 'Newest first.' })
  points!: EmployeeLegalEntityPointResponseDto[];
}

export class AssignedEmployeeResponseDto {
  @ApiProperty({ format: 'uuid' })
  employeeId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'The entity that day held before, if it was corrected.' })
  replaced!: string | null;
}
