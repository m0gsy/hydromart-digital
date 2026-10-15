import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { SecurityPolicyRecord } from '../../application/ports/security-policy.repository';

/* ---------- Requests ---------- */

export class SaveSecurityPolicyDto {
  @ApiProperty({
    example: 60,
    minimum: 0,
    maximum: 1440,
    description:
      'Idle minutes before a HEAD-OFFICE account is signed out. 0 = off (default); otherwise 30–1440. Never applies to customers, couriers or depot staff.',
  })
  @IsInt()
  @Min(0)
  @Max(1440)
  idleTimeoutMinutes!: number;

  @ApiProperty({ example: true, description: 'Whether 2FA is mandatory for HQ accounts.' })
  @IsBoolean()
  require2fa!: boolean;

  @ApiProperty({
    type: [String],
    example: ['103.21.0.0/16'],
    description: 'CIDR allowlist (empty = anywhere).',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ipAllowlist!: string[];

  @ApiPropertyOptional({
    description:
      'The `updatedAt` this edit started from. The write is refused (409) if the stored row has moved since.',
    format: 'date-time',
  })
  @IsOptional()
  @IsISO8601()
  seenUpdatedAt?: string;
}

/* ---------- Responses ---------- */

export class SecurityPolicyDto {
  @ApiProperty({ example: 0 })
  idleTimeoutMinutes!: number;
  @ApiProperty({ example: true })
  require2fa!: boolean;
  @ApiProperty({ type: [String] })
  ipAllowlist!: string[];
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: SecurityPolicyRecord): SecurityPolicyDto {
    return {
      idleTimeoutMinutes: record.idleTimeoutMinutes,
      require2fa: record.require2fa,
      ipAllowlist: record.ipAllowlist,
      updatedAt: record.updatedAt,
    };
  }
}
