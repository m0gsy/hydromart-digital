import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { LoanRequestStatus } from '../../../prisma/generated/client';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * What the applicant may say, and it is deliberately only two things (K3).
 *
 * No `installmentAmount`, no `startPeriod`: the terms of a debt are the approver's to set,
 * and a field the applicant can fill is a field the applicant can argue about later. The
 * validators copy `CreateLoanDto` — `@IsInt() @IsPositive()`, and no `@Max`, because the
 * ceiling on a kasbon is a business decision nobody has made and a made-up number in a
 * validator would quietly become that decision.
 */
export class SubmitLoanRequestDto {
  @IsInt() @IsPositive() amount!: number;
  @IsString() @MaxLength(300) reason!: string;
}

export class DecideLoanRequestDto {
  @IsBoolean() approve!: boolean;
  /** Required when rejecting — the applicant reads it. */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Required when approving: the approver sets the terms (K3). */
  @IsOptional() @IsInt() @IsPositive() installmentAmount?: number;
  @IsOptional()
  @Matches(PERIOD, { message: 'startPeriod harus format YYYY-MM' })
  startPeriod?: string;
  /** CA-2-53: the version of the request this decision was made against. */
  @IsOptional() @IsString() seenUpdatedAt?: string;
}

export class ListLoanRequestDto {
  @IsOptional() @IsEnum(LoanRequestStatus) status?: LoanRequestStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20;
}
