import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApplySchemeItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  depotId!: string;

  @ApiPropertyOptional({ example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string;

  @ApiProperty({ example: 20, minimum: 0, maximum: 100, description: 'Payout percentage.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  pct!: number;
}

export class ApplySchemeDto {
  @ApiProperty({ example: '2026-08-01', description: 'Date the new scheme takes effect.' })
  @IsDateString()
  effectiveDate!: string;

  @ApiProperty({ type: [ApplySchemeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ApplySchemeItemDto)
  items!: ApplySchemeItemDto[];
}
