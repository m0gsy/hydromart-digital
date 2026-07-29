import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UpsertPerformanceDto {
  @IsUUID() employeeId!: string;
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
  @IsNumber() @Min(0) @Max(100) score!: number;
  @IsOptional() @IsObject() metrics?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() @MaxLength(500) managerNote?: string;
}

export class PerformanceQueryDto {
  @IsUUID() employeeId!: string;
}

export class ScorePerformanceDto {
  @IsUUID() employeeId!: string;
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
}

export class PerformanceDashboardDto {
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
  @IsOptional() @IsUUID() depotId?: string;
}

export class GeneratePerformanceDto {
  @IsUUID() employeeId!: string;
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
  @IsOptional() @IsString() @MaxLength(500) managerNote?: string;
}
