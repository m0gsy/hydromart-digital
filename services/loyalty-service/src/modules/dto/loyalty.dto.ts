import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsPositive, IsString, IsUUID, Max, MaxLength, Min, NotEquals } from 'class-validator';

import { MembershipTier, benefitFor } from '../../domain/membership';
import { PointsTxnType } from '../../domain/points';
import {
  LoyaltyAccountRecord,
  PointsTransactionRecord,
} from '../../application/ports/loyalty.repository';

/* ---------- Requests ---------- */

export class EarnPointsDto {
  @ApiProperty({ format: 'uuid', description: 'Customer whose account earns the points.' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid', description: 'Completed order that generated the points (BR-013).' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 60000, description: 'Order product subtotal in IDR (delivery excluded).' })
  @Type(() => Number)
  @IsPositive()
  subtotal!: number;
}

export class AdjustPointsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: 100, description: 'Signed point delta; must not be zero.' })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  points!: number;

  @ApiProperty({ example: 'Goodwill credit for delayed delivery.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}

export class RewardPointsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: 500, description: 'Positive points to grant (system reward, e.g. referral).' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  points!: number;

  @ApiProperty({ example: 'Referral reward: referred a new customer.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}

export class ListTransactionsQueryDto {
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

export class LoyaltyAccountDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;
  @ApiProperty({ enum: MembershipTier })
  tier!: MembershipTier;
  @ApiProperty({ example: 1200 })
  pointsBalance!: number;
  @ApiProperty({ example: 6400 })
  lifetimePoints!: number;
  @ApiProperty({ example: 0.05, description: 'Membership discount rate for this tier (FR-032).' })
  discountRate!: number;

  static from(account: LoyaltyAccountRecord): LoyaltyAccountDto {
    return {
      customerId: account.customerId,
      tier: account.tier,
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      discountRate: benefitFor(account.tier).discountRate,
    };
  }
}

export class PointsTransactionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: PointsTxnType })
  type!: PointsTxnType;
  @ApiProperty({ example: 60 })
  points!: number;
  @ApiProperty({ nullable: true, format: 'uuid' })
  orderId!: string | null;
  @ApiProperty({ nullable: true })
  reason!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  expiresAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  static from(txn: PointsTransactionRecord): PointsTransactionDto {
    return {
      id: txn.id,
      type: txn.type,
      points: txn.points,
      orderId: txn.orderId,
      reason: txn.reason,
      expiresAt: txn.expiresAt,
      createdAt: txn.createdAt,
    };
  }
}
