import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

import { SubscriptionCadence, SubscriptionStatus } from '../../domain/subscription';

export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the subscription belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Linked customer account, if any.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ example: 'Ibu Sari' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName!: string;

  @ApiProperty({ example: 'Galon 19L' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  productLabel!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ enum: SubscriptionCadence })
  @IsEnum(SubscriptionCadence)
  cadence!: SubscriptionCadence;

  @ApiPropertyOptional({ example: '2026-07-25', description: 'Next scheduled run date.' })
  @IsOptional()
  @IsISO8601()
  nextRunAt?: string;

  @ApiPropertyOptional({ example: 'Antar pagi hari' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListSubscriptionQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list subscriptions for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}
