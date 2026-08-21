import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { SubscriptionCadence, SubscriptionStatus } from '../../domain/subscription';

export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the subscription belongs to.' })
  @IsUUID()
  depotId!: string;

  /**
   * Required (S2). It used to be optional, and most rows were created without it — so the
   * depot CRM could not tell a subscriber from anyone else, and `isSubscriber` was a
   * hardcoded null on every card. A free-text name is a note, not a link; the console form
   * now picks a registered customer. Rows created before this stay unlinked until someone
   * fixes them by hand.
   */
  @ApiProperty({ format: 'uuid', description: 'Linked customer account.' })
  @IsUUID()
  customerId!: string;

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

  /**
   * D10: what the operator picked, not what they typed. The engine places orders for a
   * product id; a free-text label cannot be delivered to anybody.
   */
  @ApiProperty({ format: 'uuid', description: 'Catalogue product the plan delivers.' })
  @IsUUID()
  productId!: string;

  /**
   * D10: the FIRST delivery. Every date after it belongs to the engine — a second schedule
   * living in this service is a second truth that drifts the moment it is written, which is
   * exactly what the frozen `nextRunAt` was.
   */
  @ApiProperty({ example: '2026-07-25', description: 'First scheduled delivery.' })
  @IsISO8601()
  firstDeliveryAt!: string;

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
