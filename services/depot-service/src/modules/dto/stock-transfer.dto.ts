import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { StockTransferStatus } from '../../domain/stock-transfer';

/** CA-2-54: one product, one quantity — two products are two transfers. */
export class SendTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fromDepotId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toDepotId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Titip lewat kurir sore' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CancelTransferDto {
  /** Required: "it came back" with no reason is a stock movement nobody can explain later. */
  @ApiProperty({ example: 'Motor mogok, barang kembali' })
  @IsString()
  @MaxLength(300)
  reason!: string;
}

export class ListTransfersDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ enum: ['in', 'out'], description: 'in = arriving here, out = sent from here' })
  @IsIn(['in', 'out'])
  direction!: 'in' | 'out';

  @ApiPropertyOptional({ enum: StockTransferStatus })
  @IsOptional()
  @IsEnum(StockTransferStatus)
  status?: StockTransferStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}
