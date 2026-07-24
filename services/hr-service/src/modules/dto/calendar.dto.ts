import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateHolidayDto {
  @IsISO8601() date!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() depotId?: string;
}

export class ListHolidayDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class CreateShiftDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsString() @MaxLength(60) name!: string;
  @Matches(HHMM, { message: 'startTime harus HH:MM' }) startTime!: string;
  @Matches(HHMM, { message: 'endTime harus HH:MM' }) endTime!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateShiftDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @Matches(HHMM) startTime?: string;
  @IsOptional() @Matches(HHMM) endTime?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListShiftDto {
  @IsOptional() @IsUUID() depotId?: string;
}
