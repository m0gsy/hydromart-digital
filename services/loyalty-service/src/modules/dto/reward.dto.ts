import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

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

export class CreateRewardItemDto {
  @ApiProperty({ example: 'Isi Ulang Galon 19L' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'gratis 1 galon', description: 'Human unit label shown under the name.' })
  @IsString()
  @MaxLength(60)
  unit!: string;

  @ApiProperty({ example: 800, description: 'Points a customer spends to redeem this.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pointsCost!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 50, nullable: true, description: 'Finite stock; omit or null = unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Every field optional — the same route retires an item (`active: false`) or restocks it. */
export class UpdateRewardItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  unit?: string;

  @ApiPropertyOptional({ example: 800 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pointsCost?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
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
  @ApiProperty({ description: 'False once retired — hidden from the customer catalogue.' })
  active!: boolean;

  static from(item: RewardItemRecord): RewardItemDto {
    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      pointsCost: item.pointsCost,
      imageUrl: item.imageUrl,
      stock: item.stock,
      active: item.active,
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
