import { OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { BonusType, DeductionType, PayrollStatus } from '../../../prisma/generated/client';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class GeneratePayrollDto {
  @IsUUID() employeeId!: string;

  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' })
  periodMonth!: string;
}

export class ListPayrollDto {
  @IsOptional() @Matches(PERIOD) periodMonth?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsEnum(PayrollStatus) status?: PayrollStatus;
  /** Narrow to one depot. Rejected when it is outside the caller's own depots (D1). */
  @IsOptional() @IsUUID() depotId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 30;
}

export class CreateBonusDto {
  @IsUUID() employeeId!: string;
  @IsEnum(BonusType) type!: BonusType;
  @IsInt() @IsPositive() amount!: number;
  @Matches(PERIOD) periodMonth!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CreateDeductionDto {
  @IsUUID() employeeId!: string;
  @IsEnum(DeductionType) type!: DeductionType;
  @IsInt() @IsPositive() amount!: number;
  @Matches(PERIOD) periodMonth!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** One import row: the create fields, but keyed by staff code instead of a UUID. */
export class ImportDeductionRowDto extends OmitType(CreateDeductionDto, ['employeeId'] as const) {
  @IsString() @MaxLength(40) employeeCode!: string;
}

export class ImportDeductionsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportDeductionRowDto)
  rows!: ImportDeductionRowDto[];
}

export class AdjustmentQueryDto {
  @IsUUID() employeeId!: string;
  @Matches(PERIOD) periodMonth!: string;
}
