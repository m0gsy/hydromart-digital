import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { EmploymentStatus, EmployeeStatus, SalaryType } from '../../../prisma/generated/client';

export class CreateEmployeeDto {
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsUUID()
  depotId!: string;

  @IsString()
  @MaxLength(80)
  position!: string;

  @IsEnum(EmploymentStatus)
  employmentStatus!: EmploymentStatus;

  @IsISO8601()
  joinDate!: string;

  @IsEnum(SalaryType)
  salaryType!: SalaryType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  dailyRate?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthlyRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  emergencyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  emergencyPhone?: string;

  @IsOptional()
  @IsUUID()
  authSubjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;
}

/** Every field optional; adds the lifecycle `status` (ACTIVE/INACTIVE/RESIGNED). */
export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsUUID() depotId?: string;
  @IsOptional() @IsString() @MaxLength(80) position?: string;
  @IsOptional() @IsEnum(EmploymentStatus) employmentStatus?: EmploymentStatus;
  @IsOptional() @IsISO8601() joinDate?: string;
  @IsOptional() @IsEnum(SalaryType) salaryType?: SalaryType;
  @IsOptional() @IsNumber() @IsPositive() dailyRate?: number;
  @IsOptional() @IsNumber() @IsPositive() monthlyRate?: number;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) bankAccount?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyName?: string;
  @IsOptional() @IsString() @MaxLength(32) emergencyPhone?: string;
  @IsOptional() @IsUUID() authSubjectId?: string;
  @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
}

export class ListEmployeesDto {
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize = 20;
}
