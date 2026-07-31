import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { Role } from '../../../domain/customer/role.enum';

export class ListStaffQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ enum: Role, description: 'Filter to a single role.' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter to staff assigned to one depot.' })
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
