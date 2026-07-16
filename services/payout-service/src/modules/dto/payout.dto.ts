import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestWithdrawalDto {
  @ApiProperty({ example: 8420000, description: 'IDR amount to withdraw (positive).' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'BCA ···· 4821', description: 'Masked destination bank account.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bankAccountRef!: string;
}

export class ReleasePayoutDto {
  @ApiProperty({ format: 'uuid', description: 'Franchise owner whose balance HQ is releasing.' })
  @IsUUID()
  franchiseOwnerId!: string;
}

export class LedgerQueryDto {
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
