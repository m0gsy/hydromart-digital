import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  HR_MANAGED_ROLES,
  STAFF_IMPORT_ROLES,
  type HrManagedRole,
  type StaffImportRole,
} from '@hydromart/access';

import { Role } from '../../../domain/customer/role.enum';

/**
 * A jabatan change in the HR module, pushed onto the login. Same reasoning as
 * `ProvisionStaffDto`, one rung wider: a promotion up the supervision chain is ordinary
 * HR work, but the office roles and SUPER_ADMIN stay out of reach of an employee form.
 */
/** hr-service switching a login off or on when somebody resigns or is re-hired. */
export class SetStaffActiveDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: false, description: 'false suspends the login; true restores it.' })
  @IsBoolean()
  active!: boolean;
}

export class AssignStaffRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ enum: HR_MANAGED_ROLES })
  @IsIn(HR_MANAGED_ROLES as readonly string[])
  role!: HrManagedRole & Role;

  @ApiPropertyOptional({ format: 'uuid', description: 'Depot to assign with the role; null clears it.' })
  @IsOptional()
  @IsUUID()
  depotId?: string | null;
}

/** Everything a provisioning call carries except the one field that decides its power. */
abstract class ProvisionStaffBaseDto {
  @ApiProperty({ example: '+628123456789' })
  @IsString()
  phone!: string;

  @ApiPropertyOptional({ example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  depotId?: string;
}

export class ProvisionStaffDto extends ProvisionStaffBaseDto {
  /**
   * Deliberately `@IsIn(STAFF_IMPORT_ROLES)` and not `@IsEnum(Role)`: this route
   * provisions accounts on behalf of an HR user who does not hold `staffAdmin`, so
   * HEAD_OFFICE/SUPER_ADMIN must be unreachable from here.
   *
   * This is the SPREADSHEET path and stays at its narrow allowlist. The single-employee
   * form uses `ProvisionManagedStaffDto` below — same reasoning, one rung wider, because
   * a human typing one name is not the same risk as a file of a thousand rows.
   */
  @ApiProperty({ enum: STAFF_IMPORT_ROLES })
  @IsIn(STAFF_IMPORT_ROLES as readonly string[])
  role!: StaffImportRole & Role;
}

/**
 * Single-employee provisioning from the HR form (`/hr/employees/new`).
 *
 * `HR_MANAGED_ROLES`, matching `AssignStaffRoleDto`: HR may already MOVE an existing
 * account onto SUPERVISOR, so being able to MINT one is not a new authority — it just
 * stops "add employee" from producing someone who cannot log in. The office roles,
 * DIREKTUR, FRANCHISE_OWNER and SUPER_ADMIN stay out of reach of an employee form, and
 * a CSV row still cannot reach even this set.
 */
export class ProvisionManagedStaffDto extends ProvisionStaffBaseDto {
  @ApiProperty({ enum: HR_MANAGED_ROLES })
  @IsIn(HR_MANAGED_ROLES as readonly string[])
  role!: HrManagedRole & Role;
}

export class PreRegisterCustomerDto {
  @ApiProperty({ example: '+628123456789' })
  @IsString()
  phone!: string;

  @ApiPropertyOptional({ example: 'Siti Aminah' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}

export class PreRegisterResultDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({
    enum: ['created', 'pending', 'active'],
    description:
      'created = new PENDING identity; pending = one already awaiting its first OTP; active = the phone already belongs to a verified account and was left untouched.',
  })
  status!: 'created' | 'pending' | 'active';
}

/**
 * Batch id lookup. A POST for a read on purpose: a depot directory can hold more ids than
 * fits a query string, and every route on this controller is already a POST.
 */
export class LookupCustomerIdsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];
}

/**
 * Retention sweep body. The cutoff comes from admin-service, which owns the policy —
 * this service never derives it, so the legal rule has exactly one home.
 */
export class PurgeBeforeDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  cutoff!: string;
}
