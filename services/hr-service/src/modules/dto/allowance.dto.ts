import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { AllowanceType } from '../../../prisma/generated/client';

export class CreateAllowanceDto {
  @IsUUID() employeeId!: string;
  @IsEnum(AllowanceType) type!: AllowanceType;
  @IsNumber() @IsPositive() amount!: number;
  @IsISO8601() effectiveFrom!: string;
  /** Omit for an open-ended allowance. */
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class ListAllowanceDto {
  @IsUUID() employeeId!: string;
}
