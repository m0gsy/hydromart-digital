import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

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

/**
 * PAR-05: the scheduler's view of the same sweep. `ok` is the J7 verdict sweep.sh greps
 * for — a 200 says the transport worked, not that the round did.
 */
export class BirthdaySweepResultDto extends BirthdayRewardResultDto {
  @ApiProperty({ example: true })
  ok!: boolean;
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

  @ApiPropertyOptional({
    description: 'Per-app fine-grained category mutes (design 7b). Merged over the stored map.',
    example: { tasks: true, promo: false },
  })
  @IsOptional()
  @IsObject()
  categories?: Record<string, boolean>;

  /**
   * K5.3: which language to WRITE this customer's notifications in.
   *
   * Whitelisted rather than free text: it selects a template table, and an unknown value
   * would either fall back silently forever or index into nothing.
   */
  @ApiPropertyOptional({ enum: ['id', 'en'], example: 'en' })
  @IsOptional()
  @IsIn(['id', 'en'])
  locale?: string;
}

export class DirectoryQueryDto {
  @ApiPropertyOptional({ enum: MembershipTier, description: 'Filter by membership tier.' })
  @IsOptional()
  @IsEnum(MembershipTier)
  tier?: MembershipTier;

  @ApiPropertyOptional({
    example: 'Bandung',
    description: 'Filter by primary-address city (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'CUS-06: resume after this customerId (the last one of the previous page).',
  })
  @IsOptional()
  @IsUUID()
  after?: string;

  @ApiPropertyOptional({ example: 1000, description: 'CUS-06: page size, 1-5000 (default 5000).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

/** CUS-06: the paging half of the by-depot id list. */
export class ByDepotQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  after?: string;

  @ApiPropertyOptional({ example: 1000, description: '1-5000 (default 5000).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

export class DirectoryRecipientDto {
  @ApiProperty({ format: 'uuid' })
  customerId!: string;
  @ApiProperty({ example: 'Andi' })
  name!: string;
  @ApiProperty({ example: '+6281234567890' })
  phone!: string;
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

/**
 * CA-3-48 — the payload auth-service pushes when a MARKETING consent row is written.
 *
 * Deliberately narrow: one customer, one boolean. This is not a general internal profile
 * write, and it must not grow into one.
 */
export class InternalSetMarketingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ description: 'False withdraws the promotional opt-in.' })
  @IsBoolean()
  allowed!: boolean;
}
