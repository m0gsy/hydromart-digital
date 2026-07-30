import { IsDateString, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Every report renders in all three (C4); pdf truncates long ones and says so on the page. */
const FORMATS = ['csv', 'xlsx', 'pdf'];

export class DashboardQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional()
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' })
  periodMonth?: string;
}

export class EmployeeReportQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsIn(FORMATS) format?: string;
}

export class AttendanceReportQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsIn(FORMATS) format?: string;
}

export class PayrollReportQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
  @IsOptional() @IsIn(FORMATS) format?: string;
}

/** Announcements are network-wide by nature, so this one carries no depot filter. */
export class RangeReportQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsIn(FORMATS) format?: string;
}
