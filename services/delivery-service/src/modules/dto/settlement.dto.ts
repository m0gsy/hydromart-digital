import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { SettlementStatus } from '../../domain/settlement';

export class SubmitSettlementDto {
  @ApiProperty({ format: 'uuid', description: 'The ended shift being settled.' })
  @IsUUID()
  shiftId!: string;

  @ApiProperty({ example: 150000, description: 'Cash handed to the cashier, whole IDR.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  depositedAmount!: number;
}

export class VerifySettlementDto {
  @ApiPropertyOptional({
    description: 'Charge a shortfall to the courier (ignored when there is no shortfall).',
  })
  @IsOptional()
  @IsBoolean()
  chargedToDriver?: boolean;

  @ApiPropertyOptional({ example: 'Counted together, short by one COD.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DisputeSettlementDto {
  @ApiProperty({ example: 'Courier and cashier counts disagree.' })
  @IsString()
  @MaxLength(500)
  note!: string;
}

export class SettlementQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Depot whose settlements to list.' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}
