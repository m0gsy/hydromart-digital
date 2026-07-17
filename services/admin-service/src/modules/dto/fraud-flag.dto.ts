import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FraudEntityType, FraudLevel, FraudStatus } from '../../domain/fraud';
import { FraudFlagRecord } from '../../application/ports/fraud-flag.repository';

/* ---------- Requests ---------- */

export class FraudFlagQueryDto {
  @ApiPropertyOptional({ enum: FraudLevel })
  @IsOptional()
  @IsEnum(FraudLevel)
  level?: FraudLevel;

  @ApiPropertyOptional({ enum: FraudStatus })
  @IsOptional()
  @IsEnum(FraudStatus)
  status?: FraudStatus;
}

/** Flag posted by a scoring job (internal auth). Values are stored verbatim. */
export class IngestFraudFlagDto {
  @ApiProperty({ enum: FraudEntityType })
  @IsEnum(FraudEntityType)
  entityType!: FraudEntityType;

  @ApiProperty({ example: 'ORD-0261' })
  @IsString()
  @MaxLength(200)
  entityRef!: string;

  @ApiProperty({ minimum: 0, maximum: 100, example: 88 })
  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty({ enum: FraudLevel })
  @IsEnum(FraudLevel)
  level!: FraudLevel;

  @ApiProperty({ type: [String], example: ['Value well above average', 'New address'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  signals!: string[];

  @ApiPropertyOptional({ enum: FraudStatus, default: FraudStatus.OPEN })
  @IsOptional()
  @IsEnum(FraudStatus)
  status?: FraudStatus;
}

/* ---------- Responses ---------- */

export class FraudFlagDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: FraudEntityType })
  entityType!: FraudEntityType;
  @ApiProperty()
  entityRef!: string;
  @ApiProperty({ minimum: 0, maximum: 100 })
  score!: number;
  @ApiProperty({ enum: FraudLevel })
  level!: FraudLevel;
  @ApiProperty({ type: [String] })
  signals!: string[];
  @ApiProperty({ enum: FraudStatus })
  status!: FraudStatus;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  static from(record: FraudFlagRecord): FraudFlagDto {
    return {
      id: record.id,
      entityType: record.entityType,
      entityRef: record.entityRef,
      score: record.score,
      level: record.level,
      signals: record.signals,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
