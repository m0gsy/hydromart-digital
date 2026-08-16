import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { Role } from '../../../domain/customer/role.enum';

/**
 * hr-service's own enums, mirrored as plain strings rather than imported: auth-service does
 * not depend on hr-service's Prisma client, and this DTO only carries the values through.
 * hr-service validates them again on arrival, where the enum actually lives.
 */
const EMPLOYMENT_STATUSES = ['TRAINING', 'PROBATION', 'PERMANENT'] as const;
const SALARY_TYPES = ['DAILY', 'MONTHLY'] as const;

export class ListStaffQueryDto {
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

  @ApiPropertyOptional({ enum: Role, description: 'Filter to a single role.' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter to staff assigned to one depot.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  // Audit F-12: the HQ global search used to pull 100 staff rows per keystroke and
  // filter them in the browser, so it could only ever find someone on the first page.
  @ApiPropertyOptional({ description: 'Case-insensitive substring of name or phone.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}

/**
 * D-5: `listDrivers` took `@Query() query: { depotId?: string }` — a bare object literal,
 * the only unvalidated query param on a controller where everything else is a DTO class.
 * Nothing validated the shape, so an unparseable `depotId` reached the repository as a
 * `where` value instead of being refused at the edge.
 */
export class ListDriversQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Restrict to one depot (HQ only).' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

export class InviteStaffDto {
  @ApiProperty({ example: '+628123456789', description: 'Phone of the account to grant a staff role.' })
  @IsString()
  phone!: string;

  @ApiProperty({ enum: Role, description: 'Staff role to assign (not CUSTOMER).' })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({ example: 'Budi Santoso', description: 'Name for a newly created account.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Depot to assign the staff member to.' })
  @IsOptional()
  @IsUUID()
  depotId?: string;

  @ApiPropertyOptional({ example: 'MOTOR', description: 'STAFF_DEPOT vehicle type (free text). Ignored for non-driver roles.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehicleType?: string;

  @ApiPropertyOptional({ example: 'B 1234 ABC', description: 'STAFF_DEPOT vehicle plate number. Ignored for non-driver roles.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plateNumber?: string;

  /*
   * Employment fields. Required, because inviting somebody now opens their employee record
   * too — an account with no employee is a person who cannot be paid, rostered or clocked
   * in, which is the exact half-a-person this release exists to stop creating.
   *
   * FRANCHISE_OWNER is the one role that skips the employee record (a business counterpart,
   * not headcount); the console hides these fields for it and sends the defaults.
   */
  @ApiProperty({ example: 'Kurir' })
  @IsString()
  @MaxLength(80)
  position!: string;

  @ApiProperty({ example: '2026-08-04' })
  @IsISO8601()
  joinDate!: string;

  @ApiProperty({ enum: EMPLOYMENT_STATUSES, example: 'PROBATION' })
  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus!: string;

  @ApiProperty({ enum: SALARY_TYPES, example: 'MONTHLY' })
  @IsIn(SALARY_TYPES)
  salaryType!: string;

  /*
   * "Required when salaryType is DAILY" was a sentence in the docs and nowhere in the code.
   * hr-service enforces it for real (`salaryRates` throws), but that refusal crosses a
   * service boundary and arrives at the caller as `503 — hr-service menolak permintaan
   * (400)`: no field name, no service name, and an account already minted with no employee
   * half behind it. The pair is checked here instead, before anything is written.
   *
   * `@Min(0)` and not "positive": the console sends `monthlyRate: 0` for FRANCHISE_OWNER,
   * the one role that skips the employee record entirely. Presence is what was missing.
   */
  @ApiPropertyOptional({ example: 150000, description: 'Required when salaryType is DAILY.' })
  @ValidateIf((o: InviteStaffDto) => o.salaryType === 'DAILY' || o.dailyRate !== undefined)
  @IsDefined({ message: 'dailyRate wajib diisi untuk tipe gaji DAILY' })
  @IsNumber()
  @Min(0)
  dailyRate?: number;

  @ApiPropertyOptional({ example: 4500000, description: 'Required when salaryType is MONTHLY.' })
  @ValidateIf((o: InviteStaffDto) => o.salaryType === 'MONTHLY' || o.monthlyRate !== undefined)
  @IsDefined({ message: 'monthlyRate wajib diisi untuk tipe gaji MONTHLY' })
  @IsNumber()
  @Min(0)
  monthlyRate?: number;
}

/**
 * Move an existing staff account to another depot. `null` clears it, which only staff
 * above depot level may end up with — the service refuses it for a depot-locked role.
 */
export class SetStaffDepotDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  depotId?: string | null;
}

/** Console switch: `false` suspends the login (and the employee record), `true` restores it. */
export class SetStaffActiveConsoleDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  active!: boolean;
}

/**
 * Bulk staff invite from the HQ spreadsheet wizard. One row is exactly one InviteStaffDto,
 * so a file can never express something the single-invite form cannot — the role allowlist,
 * the depot requirement and the phone rules are the same code either way.
 *
 * Deliberately NOT bounded by STAFF_IMPORT_ROLES: that allowlist exists because hr-service
 * provisions accounts on an HR user's behalf from employee data. This endpoint IS the staff
 * console, where minting an office account is the point, and it carries staffAdmin.
 */
export class ImportStaffDto {
  @ApiProperty({ type: [InviteStaffDto], description: 'Rows to invite, in file order.' })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => InviteStaffDto)
  rows!: InviteStaffDto[];
}
