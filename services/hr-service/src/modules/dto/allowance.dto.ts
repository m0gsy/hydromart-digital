import { OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
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

/** One import row: the create fields, but keyed by staff code instead of a UUID. */
export class ImportAllowanceRowDto extends OmitType(CreateAllowanceDto, ['employeeId'] as const) {
  @IsString() @MaxLength(40) employeeCode!: string;
}

export class ImportAllowancesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportAllowanceRowDto)
  rows!: ImportAllowanceRowDto[];
}
