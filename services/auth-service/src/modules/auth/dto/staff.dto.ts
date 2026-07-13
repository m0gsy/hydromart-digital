import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
}
