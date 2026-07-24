import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

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

export class AdjustmentQueryDto {
  @IsUUID() employeeId!: string;
  @Matches(PERIOD) periodMonth!: string;
}
