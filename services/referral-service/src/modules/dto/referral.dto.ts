import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { ReferralStatus } from '../../domain/referral-status';
import { ReferralSummary } from '../../application/services/referral.service';
import { ReferralCodeRecord, ReferralRecord } from '../../application/ports/referral.repository';

/* ---------- Requests ---------- */

export class RedeemReferralDto {
  @ApiProperty({ example: 'A1B2C3D4', description: "The referrer's shareable referral code." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;
}

export class QualifyReferralDto {
  @ApiProperty({ format: 'uuid', description: 'Referee (new customer) whose referral qualifies.' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid', description: 'Completed order that qualified the referral.' })
  @IsUUID()
  orderId!: string;
}

export class ReferralPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

/* ---------- Responses ---------- */

export class ReferralCodeDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;
  @ApiProperty({ example: 'A1B2C3D4' })
  code!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(record: ReferralCodeRecord): ReferralCodeDto {
    return { customerId: record.customerId, code: record.code, createdAt: record.createdAt };
  }
}

export class ReferralDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  referrerCustomerId!: string;
  @ApiProperty({ format: 'uuid' })
  refereeCustomerId!: string;
  @ApiProperty({ example: 'A1B2C3D4' })
  code!: string;
  @ApiProperty({ enum: ReferralStatus })
  status!: ReferralStatus;
  @ApiProperty({ nullable: true, format: 'uuid' })
  qualifyingOrderId!: string | null;
  @ApiProperty({ example: 500 })
  referrerPoints!: number;
  @ApiProperty({ example: 250 })
  refereePoints!: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  qualifiedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(record: ReferralRecord): ReferralDto {
    return {
      id: record.id,
      referrerCustomerId: record.referrerCustomerId,
      refereeCustomerId: record.refereeCustomerId,
      code: record.code,
      status: record.status,
      qualifyingOrderId: record.qualifyingOrderId,
      referrerPoints: record.referrerPoints,
      refereePoints: record.refereePoints,
      qualifiedAt: record.qualifiedAt,
      createdAt: record.createdAt,
    };
  }
}

export class ReferralSummaryDto {
  @ApiProperty({ type: ReferralCodeDto })
  code!: ReferralCodeDto;
  @ApiProperty({ type: [ReferralDto] })
  referrals!: ReferralDto[];
  @ApiProperty({ example: 4, description: 'Total customers referred by this customer.' })
  referredCount!: number;
  @ApiProperty({ example: 2, description: 'Referrals that have qualified.' })
  qualifiedCount!: number;
  @ApiProperty({ example: 1000, description: 'Loyalty points earned from qualified referrals.' })
  pointsEarned!: number;
  @ApiProperty({ example: 4 })
  total!: number;
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
  @ApiProperty({ example: 1 })
  totalPages!: number;

  static from(summary: ReferralSummary): ReferralSummaryDto {
    return {
      code: ReferralCodeDto.from(summary.code),
      referrals: summary.referrals.items.map((r) => ReferralDto.from(r)),
      referredCount: summary.referredCount,
      qualifiedCount: summary.qualifiedCount,
      pointsEarned: summary.pointsEarned,
      total: summary.referrals.total,
      page: summary.referrals.page,
      limit: summary.referrals.limit,
      totalPages: summary.referrals.totalPages,
    };
  }
}
