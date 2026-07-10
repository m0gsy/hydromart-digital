import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID, ValidateIf } from 'class-validator';

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
}
