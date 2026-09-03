import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGallonIssueDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Customer who took the empties (omit for walk-ins).',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ example: 3, description: 'Number of empty gallons issued.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ example: 15000, default: 0, description: 'Deposit held in whole IDR.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  depositHeld?: number;

  @ApiPropertyOptional({ example: 'Galon dibawa pelanggan, deposit tunai' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/**
 * I1: what fulfilment reports. No `depositHeld` on purpose — the deposit is derived from
 * the depot's own rate server-side, so a caller cannot book money the depot never charged.
 * The ledger is what every later refund is measured against.
 */
export class CreateGallonIssueFromOrderDto {
  @ApiProperty({ format: 'uuid', description: 'Order the empties went out on.' })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Customer who took the empties (omit for an anonymous counter sale).',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ example: 2, description: 'Number of gallons carried out.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class ListIssuesQueryDto {
  @ApiPropertyOptional({ default: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
