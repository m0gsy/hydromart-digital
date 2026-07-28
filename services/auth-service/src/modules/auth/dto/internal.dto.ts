import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { STAFF_IMPORT_ROLES, type StaffImportRole } from '@hydromart/access';

import { Role } from '../../../domain/customer/role.enum';

export class ProvisionStaffDto {
  @ApiProperty({ example: '+628123456789' })
  @IsString()
  phone!: string;

  /**
   * Deliberately `@IsIn(STAFF_IMPORT_ROLES)` and not `@IsEnum(Role)`: this route
   * provisions accounts on behalf of an HR user who does not hold `staffAdmin`, so
   * HEAD_OFFICE/SUPER_ADMIN must be unreachable from here.
   */
  @ApiProperty({ enum: STAFF_IMPORT_ROLES })
  @IsIn(STAFF_IMPORT_ROLES as readonly string[])
  role!: StaffImportRole & Role;

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
