import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { RewardItemRecord } from '../../application/ports/reward.repository';
import { RedeemResult } from '../../application/services/reward.service';

/* ---------- Requests ---------- */

export class RedeemRewardDto {
  @ApiProperty({ format: 'uuid', description: 'Catalog item to redeem.' })
  @IsUUID()
  rewardItemId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Client-generated key; a repeat submit is a no-op (idempotent).',
  })
  @IsUUID()
  idempotencyKey!: string;
}

/* ---------- Responses ---------- */

export class RewardItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ example: 'Isi Ulang Galon 19L' })
  name!: string;
  @ApiProperty({ example: 'gratis 1 galon' })
  unit!: string;
  @ApiProperty({ example: 800 })
  pointsCost!: number;
  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Remaining stock; null = unlimited.' })
  stock!: number | null;

  static from(item: RewardItemRecord): RewardItemDto {
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      pointsCost: item.pointsCost,
      imageUrl: item.imageUrl,
      stock: item.stock,
    };
  }
}

export class RedeemResultDto {
  @ApiProperty({ format: 'uuid' })
  redemptionId!: string;
  @ApiProperty({ format: 'uuid' })
  rewardItemId!: string;
  @ApiProperty({ example: 800 })
  pointsSpent!: number;
  @ApiProperty({ example: 1300, description: 'Spendable balance after the debit.' })
  pointsBalance!: number;

  static from(result: RedeemResult): RedeemResultDto {
    return {
      redemptionId: result.redemption.id,
      rewardItemId: result.redemption.rewardItemId,
      pointsSpent: result.redemption.pointsSpent,
      pointsBalance: result.pointsBalance,
    };
  }
}
