import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { STAFF_IMPORT_ROLES, type StaffImportRole } from '@hydromart/access';

import {
  EmploymentStatus,
  EmployeeStatus,
  Gender,
  PtkpStatus,
  SalaryType,
} from '../../../prisma/generated/client';
import type { ImportMode } from '../../application/services/employee.service';

export class CreateEmployeeDto {
  /** Carry a code over from an older system. Omit and the service mints HR-####. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeCode?: string;

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

  @IsOptional()
  @IsUUID()
  supervisorId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  /** Org unit. Must be network-wide or belong to the same depot as this employee. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  npwp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bpjsKes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bpjsTk?: string;

  /** KTP number: 16 digits, no spaces. Rejected rather than trimmed — a 15-digit NIK is a
   *  typo, and it is the key the upsert matches on. */
  @IsOptional()
  @Matches(/^\d{16}$/, { message: 'nik harus 16 digit angka' })
  nik?: string;

  @IsOptional()
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsEnum(PtkpStatus)
  ptkpStatus?: PtkpStatus;

  @IsOptional()
  @IsISO8601()
  contractEndDate?: string;
}

/** One CSV row: the create fields plus the login role to provision, minus authSubjectId
 * (the import gets that back from auth-service, it is never supplied by the file). */
export class ImportEmployeeRowDto extends OmitType(CreateEmployeeDto, ['authSubjectId'] as const) {
  @IsIn(STAFF_IMPORT_ROLES as readonly string[])
  role!: StaffImportRole;

  /** The supervisor's staff code (`HR-0007`), resolved server-side after every row is in. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  supervisorCode?: string;
}

export class ImportEmployeesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportEmployeeRowDto)
  rows!: ImportEmployeeRowDto[];

  /** Default CREATE: an existing person is reported `skipped`, never overwritten. */
  @IsOptional()
  @IsIn(['CREATE', 'UPSERT'])
  mode?: ImportMode;
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
  @IsOptional() @IsUUID() supervisorId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) npwp?: string;
  @IsOptional() @IsString() @MaxLength(40) bpjsKes?: string;
  @IsOptional() @IsString() @MaxLength(40) bpjsTk?: string;
  @IsOptional() @Matches(/^\d{16}$/, { message: 'nik harus 16 digit angka' }) nik?: string;
  @IsOptional() @IsISO8601() birthDate?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsEnum(PtkpStatus) ptkpStatus?: PtkpStatus;
  @IsOptional() @IsISO8601() contractEndDate?: string;
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
  @IsUUID()
  departmentId?: string;

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

/** Retention report body — the cutoff is computed by admin-service, never here. */
export class RetentionReportDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  cutoff!: string;
}
