import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

/** What the screen showed for one employee on the day being written. */
export class SeenEmployeePointDto {
  @ApiProperty({ format: 'uuid', description: 'An employee of this request.' })
  @IsUUID()
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'The legal entity the screen showed for them on that day.' })
  @IsUUID()
  legalEntityId!: string;
}

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

  @ApiProperty({
    type: [SeenEmployeePointDto],
    description:
      'Every employee that already had a point on that day in the copy the screen read, with its ' +
      'entity. One not listed was shown with none. 409 STALE_WRITE when the stored day differs.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SeenEmployeePointDto)
  seen!: SeenEmployeePointDto[];
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
