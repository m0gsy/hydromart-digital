import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

import {
  LAB_TEST_KINDS,
  LabTestKind,
  LabTestResult,
  QUALITY_HOLD_REASONS,
  QualityHoldReason,
} from '../../domain/quality-hold';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

// No backslashes on purpose: character classes only.
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export class StartQualityHoldDto {
  @ApiProperty({ enum: QUALITY_HOLD_REASONS })
  @IsIn(QUALITY_HOLD_REASONS)
  reasonCode!: QualityHoldReason;

  @ApiPropertyOptional({ maxLength: 500, description: 'Staff note. Never leaves hydromart.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class EndQualityHoldDto {
  @ApiProperty({ format: 'uuid', description: 'The PASS lab test (this depot, taken on or after the hold started).' })
  @IsUUID()
  retestId!: string;
}

export class CreateLabTestDto {
  @ApiProperty({ enum: LAB_TEST_KINDS })
  @IsIn(LAB_TEST_KINDS)
  kind!: LabTestKind;

  @ApiProperty({ example: '2026-11-20', description: 'WIB day the sample was taken.' })
  @Matches(DAY)
  takenOn!: string;

  @ApiProperty({ example: '2026-11-25', description: 'WIB day the result came.' })
  @Matches(DAY)
  resultOn!: string;

  @ApiProperty({ enum: ['PASS', 'FAIL'] })
  @IsIn(['PASS', 'FAIL'])
  result!: LabTestResult;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  labName!: string;

  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  reportNo!: string;
}

export class CreatePermitDto {
  @ApiProperty({ example: 'SLHS', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  kind!: string;

  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  number!: string;

  @ApiProperty({ example: '2027-11-20', description: 'Last WIB day the permit is valid.' })
  @Matches(DAY)
  validUntil!: string;
}
