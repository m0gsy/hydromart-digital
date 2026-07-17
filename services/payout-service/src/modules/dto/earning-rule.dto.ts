import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

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

  @ApiProperty({ example: '2026-08-01', description: 'Date the rule takes effect.' })
  @IsDateString()
  effectiveDate!: string;
}
