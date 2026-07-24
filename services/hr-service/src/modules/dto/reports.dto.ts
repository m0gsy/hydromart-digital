import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class DashboardQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth?: string;
}

export class EmployeeReportQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
}

export class AttendanceReportQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @IsDateString() from!: string;
  @IsDateString() to!: string;
}

export class PayrollReportQueryDto {
  @IsOptional() @IsUUID() depotId?: string;
  @Matches(PERIOD, { message: 'periodMonth harus format YYYY-MM' }) periodMonth!: string;
}
