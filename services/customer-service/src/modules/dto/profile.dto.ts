import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsUUID, ValidateIf } from 'class-validator';

import { MembershipTier } from '../../domain/membership-tier.enum';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Preferred depot id, or null to clear.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  favoriteDepotId?: string | null;

  @ApiPropertyOptional({
    description: 'Date of birth (YYYY-MM-DD), or null to clear. Drives the birthday promo.',
    example: '1990-05-17',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsDateString({ strict: true })
  birthdate?: string | null;
}

export class BirthdayRewardResultDto {
  @ApiProperty({ example: '2026-05-17' })
  date!: string;
  @ApiProperty({ example: 3 })
  candidates!: number;
  @ApiProperty({ example: 3 })
  granted!: number;
  @ApiProperty({ example: 0 })
  failed!: number;
  @ApiProperty({ example: false, description: 'True when LOYALTY_SERVICE_URL is unset.' })
  disabled!: boolean;
}

export class UpdateNotificationsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;
}

export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;
  @ApiProperty({ enum: MembershipTier })
  membershipTier!: MembershipTier;
  @ApiProperty({ example: 0 })
  pointBalance!: number;
  @ApiProperty({ nullable: true, format: 'uuid' })
  favoriteDepotId!: string | null;
  @ApiProperty({ nullable: true, example: '1990-05-17', description: 'DOB as YYYY-MM-DD.' })
  birthdate!: string | null;
}
