import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

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

  @ApiProperty({
    format: 'uuid',
    description: 'Completed order that generated the points (BR-013).',
  })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    example: 60000,
    description: 'Order product subtotal in IDR (delivery excluded).',
  })
  @Type(() => Number)
  @IsPositive()
  subtotal!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "The order's depot, so a per-depot earn-rate/expiry override applies. Omitted = GLOBAL only.",
  })
  @IsOptional()
  @IsUUID()
  depotId?: string;
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

/** Reversing a sale: the order says how much to take back, so no amount is accepted. */
export class ReverseEarnDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'Penjualan konter dibatalkan.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;
}

export class RewardPointsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({
    example: 500,
    description: 'Positive points to grant (system reward, e.g. referral).',
  })
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

export class DepotSummaryQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to aggregate loyalty over.' })
  @IsUUID()
  depotId!: string;
}

/** Optional depot scope: which depot's membership ladder to answer against. */
export class TierScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: "Depot whose ladder applies; omit for the global one." })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
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
  @ApiProperty({
    enum: MembershipTier,
    description: 'Tier at the queried depot; the global tier when no depotId was given.',
  })
  tier!: MembershipTier;
  @ApiProperty({ example: 1200 })
  pointsBalance!: number;
  @ApiProperty({ example: 6400 })
  lifetimePoints!: number;
  @ApiProperty({ example: 0.05, description: 'Membership discount rate for this tier (FR-032).' })
  discountRate!: number;

  /** `tier`/`discountRate` come from the caller's standing so a depot ladder can apply. */
  static from(
    account: LoyaltyAccountRecord,
    tier: MembershipTier = account.tier,
    discountRate: number = benefitFor(account.tier).discountRate,
  ): LoyaltyAccountDto {
    return {
      customerId: account.customerId,
      tier,
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      discountRate,
    };
  }
}

/**
 * The earn response: the account plus what THIS call awarded. order-service needs the
 * number to word its "you earned N points" message; computing it there again would
 * mirror an earn rate that is per-depot and would drift the moment a depot overrides it.
 */
export class EarnResultDto extends LoyaltyAccountDto {
  @ApiProperty({
    example: 60,
    description: 'Points this call awarded; 0 when already earned or the subtotal is too small.',
  })
  pointsEarned!: number;
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
