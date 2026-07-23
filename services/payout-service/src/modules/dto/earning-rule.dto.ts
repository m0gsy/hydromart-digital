import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** One rung of the monthly delivery-count incentive ladder (design 6b). */
export class IncentiveTierDto {
  @ApiProperty({ example: 25, minimum: 1, description: 'Deliveries in the month that unlock the bonus.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deliveries!: number;

  @ApiProperty({ example: 25000, minimum: 0, description: 'One-off IDR credit for the rung.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bonus!: number;
}

/** Apply a new effective-dated courier earning rule (design 6b). */
export class ApplyEarningRuleDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Depot the rule applies to; omit for the network default.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiProperty({ example: 5000, minimum: 0, description: 'Flat pay per completed delivery (IDR).' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseFare!: number;

  @ApiProperty({ example: 2000, minimum: 0, description: 'Bonus added when the delivery completes in peak hours.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  peakBonus!: number;

  @ApiProperty({ example: 1000, minimum: 0, description: 'Bonus added when the delivery beat its SLA.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  onTimeBonus!: number;

  @ApiProperty({ example: 17, minimum: 0, maximum: 23, description: 'Peak window start hour (WIB).' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  peakStartHour!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 24, description: 'Peak window end hour (WIB, exclusive).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  peakEndHour!: number;

  @ApiPropertyOptional({ example: 5000000, minimum: 0, description: 'Monthly earnings target (IDR); 0 = none.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyTarget?: number;

  @ApiPropertyOptional({ type: [IncentiveTierDto], description: 'Monthly incentive ladder; omit for none.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => IncentiveTierDto)
  tiers?: IncentiveTierDto[];

  @ApiProperty({ example: '2026-08-01', description: 'Date the rule takes effect.' })
  @IsDateString()
  effectiveDate!: string;
}
