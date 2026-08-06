import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
