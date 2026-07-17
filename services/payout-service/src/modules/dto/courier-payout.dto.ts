import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Delivery-completion event pushed by delivery-service (internal auth). */
export class DeliveryCompletedEventDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  courierId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  depotId?: string | null;

  @ApiProperty({ format: 'uuid', description: 'Idempotency key: one earning per delivery.' })
  @IsUUID()
  deliveryId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  deliveredAt!: string;

  @ApiProperty({ description: 'Whether the delivery beat its SLA.' })
  @IsBoolean()
  onTime!: boolean;
}

export class CourierLedgerQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
