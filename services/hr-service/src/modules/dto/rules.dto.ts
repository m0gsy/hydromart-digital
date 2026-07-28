import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { BonusType } from '../../../prisma/generated/client';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const METRICS = ['ATTENDANCE_RATE', 'PRESENT_DAYS', 'ZERO_LATE', 'IS_DEPOT_MANAGER', 'SALES_TOTAL'];
const OPS = ['GTE', 'LTE', 'EQ'];
const REWARD_KINDS = ['FIXED', 'PERCENT'];

export class CreateBonusRuleDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsEnum(BonusType) bonusType!: BonusType;
  @IsString() @MaxLength(120) name!: string;
  @IsIn(METRICS) metric!: string;
  @IsIn(OPS) op!: string;
  @IsNumber() @Min(0) threshold!: number;
  @IsIn(REWARD_KINDS) rewardKind!: string;
  @IsNumber() @Min(0) rewardValue!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateBonusRuleDto {
  @IsOptional() @IsEnum(BonusType) bonusType?: BonusType;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(METRICS) metric?: string;
  @IsOptional() @IsIn(OPS) op?: string;
  @IsOptional() @IsNumber() @Min(0) threshold?: number;
  @IsOptional() @IsIn(REWARD_KINDS) rewardKind?: string;
  @IsOptional() @IsNumber() @Min(0) rewardValue?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListBonusRuleDto {
  /** Omit → all rules; "global" → null-depot rules; a UUID → that depot's rules. */
  @IsOptional() @IsString() depotId?: string;
}

export class CreateLoanDto {
  @IsUUID() employeeId!: string;
  @IsInt() @IsPositive() principal!: number;
  @IsInt() @IsPositive() installmentAmount!: number;
  @Matches(PERIOD, { message: 'startPeriod harus format YYYY-MM' }) startPeriod!: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class ListLoanDto {
  @IsUUID() employeeId!: string;
  @IsOptional() @Matches(PERIOD) asOfPeriod?: string;
}
