import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { DisputeCategory, DisputeResolution, DisputeStatus } from '../../domain/order-dispute';

export class CreateDisputeDto {
  @ApiProperty({ format: 'uuid', description: 'Depot the order belongs to.' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: 'HM-...000476' })
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  orderRef!: string;

  @ApiProperty({ example: 'Ibu Sari' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName!: string;

  @ApiProperty({ enum: DisputeCategory })
  @IsEnum(DisputeCategory)
  category!: DisputeCategory;

  @ApiProperty({ example: 'Galon yang diterima tersegel rusak' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({ example: 20000, description: 'Rupiah at stake (refund/overcharge).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountIdr?: number;

  @ApiPropertyOptional({ example: 'Budi', description: 'Courier involved, if any.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;
}

export class ListDisputeQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot to list disputes for.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: DisputeStatus })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeResolution })
  @IsEnum(DisputeResolution)
  resolution!: DisputeResolution;

  @ApiPropertyOptional({ example: 'Dana dikembalikan via transfer' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}

/** DPT-2: the subject of an erasure, as auth-service's registry sends it. */
export class PdpAnonymiseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '+628123456789',
    description:
      'An incident only ever carries the number the operator wrote down, never an account id.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}

/** DPT-2: how many rows lost the person named in them. */
export class PdpErasedResponseDto {
  @ApiProperty({ example: 7 })
  erased!: number;
}
