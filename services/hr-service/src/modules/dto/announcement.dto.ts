import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AnnouncementDimension, AnnouncementLevel } from '../../../prisma/generated/client';

const DIMENSIONS: AnnouncementDimension[] = [
  'COMPANY',
  'DEPOT',
  'DEPARTMENT',
  'POSITION',
  'EMPLOYEE',
];
const LEVELS: AnnouncementLevel[] = ['INFO', 'WARNING', 'URGENT'];

export class AnnouncementTargetDto {
  @IsIn(DIMENSIONS) dimension!: AnnouncementDimension;
  /** Depot id, department id, position text, or employee id. Omitted for COMPANY. */
  @IsOptional() @IsString() @MaxLength(120) value?: string;
}

export class CreateAnnouncementDto {
  @IsString() @MaxLength(160) title!: string;
  @IsString() @MaxLength(4000) body!: string;
  @IsOptional() @IsIn(LEVELS) level?: AnnouncementLevel;
  /** Future ISO timestamp = wait for the publish-due sweep. Past or absent = send now. */
  @IsOptional() @IsDateString() scheduledAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementTargetDto)
  targets!: AnnouncementTargetDto[];
}

export class ListAnnouncementDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
