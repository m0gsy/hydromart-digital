import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
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

/** The window depot-service asks about when it closes a day's books. */
export class DepositedCodQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiProperty({ example: '2026-08-04T00:00:00.000Z' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-08-05T00:00:00.000Z' })
  @IsISO8601()
  to!: string;
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

/**
 * The one settlement rule the cashier screen states in prose.
 *
 * `SURPLUS_NOTE_THRESHOLD_IDR` is a constant on purpose (see its comment: one fewer number
 * every depot must fill in before go-live), and the screen's note quoted it as a literal.
 * A constant held in two places is still two places, and the screen is the one nobody
 * would remember. It reads the number from the side that enforces it.
 */
export class SettlementRulesDto {
  @ApiProperty({ description: 'A surplus above this needs a written note before verifying (C1).' })
  surplusNoteThresholdIdr!: number;
}
